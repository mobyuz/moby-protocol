import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { EXPRESSIONS, PACKAGE_VERSION, canTransition } from "@mobyuz/moby-protocol";

const fixture = JSON.parse(await readFile(new URL("./fixtures/wire.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv, ["date-time"]);
ajv.addKeyword({ keyword: "x-package-version", schemaType: "string", valid: true });
const validators = {};
for (const name of [
  "stable-id", "expression", "chat-request", "chat-response", "tool-request", "api-error",
  "agent-turn-request", "agent-turn-response", "tool-result", "language", "script", "consent-type", "usage-info",
]) {
  const schema = JSON.parse(await readFile(new URL(`../schema/${name}.schema.json`, import.meta.url), "utf8"));
  assert.equal(schema["x-package-version"], PACKAGE_VERSION);
  validators[name] = ajv.compile(schema);
}

test("all shared Rust wire fixtures validate against generated JSON Schema", () => {
  for (const [schema, value] of [
    ["chat-request", fixture.chat_request],
    ["chat-response", fixture.chat_response],
    ["chat-response", fixture.chat_response_without_tool],
    ["chat-response", fixture.chat_response_null_tool],
    ["api-error", fixture.api_error],
    ["usage-info", fixture.usage_info],
    ...fixture.tools.map((tool) => ["tool-request", tool]),
    ...fixture.expressions.map((expression) => ["expression", expression]),
    ...fixture.agent_turn_requests.map((value) => ["agent-turn-request", value]),
    ...fixture.agent_turn_responses.map((value) => ["agent-turn-response", value]),
    ...fixture.tool_results.map((value) => ["tool-result", value]),
    ...fixture.languages.map((value) => ["language", value]),
    ...fixture.scripts.map((value) => ["script", value]),
    ...fixture.consent_types.map((value) => ["consent-type", value]),
  ]) {
    assert.equal(validators[schema](value), true, JSON.stringify(validators[schema].errors));
  }
});

test("schemas reject unknown tools, extra fields, missing arguments, and path-like IDs", () => {
  const validate = validators["tool-request"];
  assert.equal(validate({ tool: "run_shell", command: "whoami" }), false);
  assert.equal(validate({ tool: "open_app", app_id: "editor", path: "C:/editor" }), false);
  for (const tool of fixture.tools) {
    for (const extra of ["path", "command", "arguments", "unexpected"]) {
      assert.equal(validate({ ...tool, [extra]: "unexpected" }), false);
    }
    for (const key of Object.keys(tool).filter((key) => key !== "tool")) {
      const optional = tool.tool === "open_project" && key === "app_id";
      if (!optional) {
        const missing = { ...tool };
        delete missing[key];
        assert.equal(validate(missing), false);
      }
      if (key.endsWith("_id")) {
        for (const invalid of [...fixture.invalid_ids, "a".repeat(65), null, 3, {}]) {
          if (optional && invalid === null) continue;
          assert.equal(validate({ ...tool, [key]: invalid }), false, JSON.stringify(invalid));
        }
      }
    }
  }
  for (const id of ["a", "desk_2-project", "a".repeat(64)]) {
    assert.equal(validators["stable-id"](id), true);
  }
});

test("tool input limits match Rust for literal queries, Unicode lengths, and zoned dates", () => {
  const validate = validators["tool-request"];
  for (const value of fixture.invalid_tools) {
    assert.equal(validate(value), false, JSON.stringify(value));
  }
  const search = { tool: "search_files", root_id: "root_moby", query: "🌐".repeat(100), max_results: 1 };
  const reminder = { tool: "create_reminder", text: "🌐".repeat(200), due_at: "2026-11-03t14:00:00z" };
  assert.equal(validate(search), true, JSON.stringify(validate.errors));
  assert.equal(validate(reminder), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...search, query: search.query + "🌐" }), false);
  assert.equal(validate({ ...reminder, text: reminder.text + "🌐" }), false);
  assert.equal(validate({ tool: "open_project", project_id: "proj_moby", app_id: null }), true);
});

test("agent schemas reject unrecognized roles, tools, and payload fields", () => {
  const request = fixture.agent_turn_requests[0];
  const validateRequest = validators["agent-turn-request"];
  assert.equal(validateRequest({
    ...request,
    resources: [{ ...request.resources[0], path: "C:/private" }],
  }), false);
  assert.equal(validateRequest({ ...request, available_tools: ["run_shell"] }), false);
  assert.equal(validateRequest({ ...request, messages: [{ kind: "system", text: "test" }] }), false);
  assert.equal(validateRequest({ ...request, language: "fr" }), false);
  const response = fixture.agent_turn_responses[1];
  assert.equal(validators["agent-turn-response"]({
    ...response,
    call: { ...response.call, request: { ...response.call.request, command: "whoami" } },
  }), false);
  assert.equal(validators["tool-result"]({ ...fixture.tool_results[1], code: "unknown" }), false);
  assert.equal(validators["usage-info"]({ ...fixture.usage_info, llm_tokens_remaining: 2 ** 32 }), false);
});

test("nested tool validation and strict message envelopes match Rust", () => {
  assert.equal(validators["chat-response"]({
    ...fixture.chat_response,
    tool_request: { ...fixture.chat_response.tool_request, command: "whoami" },
  }), false);
  assert.equal(validators["chat-request"]({ ...fixture.chat_request, provider_api_key: "not-a-key" }), false);
  assert.equal(validators["api-error"]({ ...fixture.api_error, stack: "private" }), false);
  for (const invalid of [{}, { text: null }, { text: 1 }]) {
    assert.equal(validators["chat-request"](invalid), false);
  }
  for (const invalid of ["unknown", "Idle", null, {}]) {
    assert.equal(validators.expression(invalid), false);
  }
});

test("generated JavaScript agrees with the exhaustive 81-pair transition table", () => {
  assert.deepEqual(EXPRESSIONS, fixture.expressions);
  for (const [fromIndex, from] of EXPRESSIONS.entries()) {
    for (const [toIndex, to] of EXPRESSIONS.entries()) {
      assert.equal(canTransition(from, to), fixture.transition_rows[fromIndex][toIndex], `${from} -> ${to}`);
    }
  }
});

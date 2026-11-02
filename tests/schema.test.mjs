import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { EXPRESSIONS, PROTOCOL_VERSION, canTransition } from "@mobyuz/moby-protocol";

const fixture = JSON.parse(await readFile(new URL("./fixtures/wire.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addKeyword({ keyword: "x-protocol-version", schemaType: "string", valid: true });
const validators = {};
for (const name of ["stable-id", "expression", "chat-request", "chat-response", "tool-request", "api-error"]) {
  const schema = JSON.parse(await readFile(new URL(`../schema/${name}.schema.json`, import.meta.url), "utf8"));
  assert.equal(schema["x-protocol-version"], PROTOCOL_VERSION);
  validators[name] = ajv.compile(schema);
}

test("all shared Rust wire fixtures validate against generated JSON Schema", () => {
  for (const [schema, value] of [
    ["chat-request", fixture.chat_request],
    ["chat-response", fixture.chat_response],
    ["chat-response", fixture.chat_response_without_tool],
    ["chat-response", fixture.chat_response_null_tool],
    ["api-error", fixture.api_error],
    ...fixture.tools.map((tool) => ["tool-request", tool]),
    ...fixture.expressions.map((expression) => ["expression", expression]),
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
      const missing = { ...tool };
      delete missing[key];
      assert.equal(validate(missing), false);
      for (const invalid of [...fixture.invalid_ids, "a".repeat(65), null, 3, {}]) {
        assert.equal(validate({ ...tool, [key]: invalid }), false, `${key}: ${JSON.stringify(invalid)}`);
      }
    }
  }
  for (const id of ["a", "desk_2-project", "a".repeat(64)]) {
    assert.equal(validators["stable-id"](id), true);
  }
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

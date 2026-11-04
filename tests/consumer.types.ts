import {
  CONTROL_MESSAGES,
  ERROR_CODES,
  PACKAGE_VERSION,
  PROTOCOL_VERSION,
  EXPRESSIONS,
  canTransition,
  type AgentTurnRequest,
  type AgentTurnResponse,
  type ApiError,
  type ChatRequest,
  type ChatResponse,
  type ControlMessage,
  type ErrorCode,
  type Expression,
  type ToolRequest,
} from "@mobyuz/moby-protocol";

const expression: Expression = "disconnected";
const request: ChatRequest = { text: "Hello" };
const response: ChatResponse = { reply: "Hello", expression: "happy" };
const nullableResponse: ChatResponse = { ...response, tool_request: null };
const tool: ToolRequest = { tool: "search_files", root_id: "desk", query: "readme", max_results: 50 };
const error: ApiError = { code: "unavailable", message: "Unavailable", request_id: "request-1" };
const packageVersion: "0.2.0" = PACKAGE_VERSION;
const protocolVersion: 1 = PROTOCOL_VERSION;
const turn: AgentTurnRequest = {
  messages: [{ kind: "user", text: "Salom" }],
  available_tools: [],
  resources: [],
  language: "uz",
  script: "latn",
};
const event: AgentTurnResponse = { event: "tool_call", call: { call_id: "call_1", request: tool } };
const allowed: boolean = canTransition(EXPRESSIONS[0], expression);
void [request, response, nullableResponse, tool, error, packageVersion, protocolVersion, turn, event, allowed];

// @ts-expect-error unsupported expression
const unknownExpression: Expression = "online";
// @ts-expect-error unsupported tool
const unknownTool: ToolRequest = { tool: "run_shell", command: "whoami" };
// @ts-expect-error project_id is required
const missingId: ToolRequest = { tool: "open_project" };
// @ts-expect-error raw path is not a field in the tool contract
const pathTool: ToolRequest = { tool: "open_app", app_id: "editor", path: "C:/editor" };
// @ts-expect-error error responses require a request ID
const missingRequestId: ApiError = { code: "unavailable", message: "Unavailable" };
void [unknownExpression, unknownTool, missingId, pathTool, missingRequestId];

const setConfig: ControlMessage = {
  name: "set_config", v: 1, kind: "command", id: "c-1", ts_ms: 1, data: { speaker_volume: 35 },
};
const pairing: ControlMessage = {
  name: "pair_begin", v: 1, kind: "command", id: "c-2", ts_ms: 2, data: { timeout_ms: 30000 },
};
const failure: ControlMessage = {
  name: "command_error", v: 1, kind: "response", id: "c-2", ts_ms: 3,
  data: { code: "E_STATE", detail: "pairing was not confirmed" },
};
const robotSender: "robot" | "desktop" = CONTROL_MESSAGES[0].sender;
const errorCode: ErrorCode = ERROR_CODES[0];
void [setConfig, pairing, failure, robotSender, errorCode];

// @ts-expect-error a command is not an event
const commandAsEvent: ControlMessage = { name: "pair_begin", v: 1, kind: "event", id: "c-3", ts_ms: 4, data: { timeout_ms: 1000 } };
// @ts-expect-error unknown control message
const unknownMessage: ControlMessage = { name: "reboot", v: 1, kind: "command", id: "c-4", ts_ms: 5, data: {} };
// @ts-expect-error unknown error code
const unknownCode: ErrorCode = "E_NONE";
void [commandAsEvent, unknownMessage, unknownCode];

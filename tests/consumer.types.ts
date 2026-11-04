import {
  PACKAGE_VERSION,
  PROTOCOL_VERSION,
  EXPRESSIONS,
  canTransition,
  type AgentTurnRequest,
  type AgentTurnResponse,
  type ApiError,
  type ChatRequest,
  type ChatResponse,
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

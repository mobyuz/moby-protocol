import {
  PROTOCOL_VERSION,
  EXPRESSIONS,
  canTransition,
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
const tool: ToolRequest = { tool: "search_files", project_id: "desk", query_id: "sources" };
const error: ApiError = { code: "unavailable", message: "Unavailable", request_id: "request-1" };
const version: "0.1.0" = PROTOCOL_VERSION;
const allowed: boolean = canTransition(EXPRESSIONS[0], expression);
void [request, response, nullableResponse, tool, error, version, allowed];

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

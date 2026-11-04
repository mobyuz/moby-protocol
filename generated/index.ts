// Generated from Rust. Run npm run generate; do not edit.

export type StableId = string;

export type Expression = "idle" | "listening" | "thinking" | "speaking" | "happy" | "confused" | "error" | "muted" | "disconnected";

export type ZonedDateTime = string;

export type SearchQuery = string;

export type SearchLimit = number;

export type ReminderText = string;

export type ToolName = "git_status" | "open_app" | "open_project" | "search_files" | "create_reminder";

export type ChatRequest = { text: string, };

export type ToolRequest = { "tool": "git_status", project_id: StableId, } | { "tool": "open_app", app_id: StableId, } | { "tool": "open_project", project_id: StableId, app_id?: StableId | null, } | { "tool": "search_files", root_id: StableId, query: SearchQuery, max_results: SearchLimit, } | { "tool": "create_reminder", text: ReminderText, due_at: ZonedDateTime, };

export type ToolCall = { call_id: StableId, request: ToolRequest, };

export type ToolFailureCode = "denied" | "invalid_request" | "unavailable" | "canceled" | "timeout" | "failed" | "partial_result";

export type ToolResult = { "status": "ok", call_id: StableId, output: string, } | { "status": "error", call_id: StableId, code: ToolFailureCode, };

export type ChatResponse = { reply: string, expression: Expression, tool_request?: ToolRequest | null, };

export type ApiError = { code: string, message: string, request_id: string, };

export type Language = "uz" | "ru" | "en";

export type Script = "latn" | "cyrl";

export type ConsentType = "terms" | "privacy_policy" | "cloud_voice";

export type UsageInfo = { llm_tokens_remaining: number, stt_seconds_remaining: number, tts_chars_remaining: number, reset_at: ZonedDateTime, };

export type ResourceKind = "app" | "project" | "search_root";

export type ToolResource = { kind: ResourceKind, id: StableId, display_name: string, };

export type AgentMessage = { "kind": "user", text: string, } | { "kind": "assistant", text: string, } | { "kind": "tool_call", call: ToolCall, } | { "kind": "tool_result", result: ToolResult, };

export type AgentTurnRequest = { messages: Array<AgentMessage>, available_tools: Array<ToolName>, resources: Array<ToolResource>, language?: Language | null, script?: Script | null, };

export type AgentTurnResponse = { "event": "speech_delta", text: string, } | { "event": "tool_call", call: ToolCall, } | { "event": "completed", speech_text: string, display_text?: string | null, expression_hint: Expression, } | { "event": "error", error: ApiError, };

export type ControlVersion = number;

export type EventKind = "event";

export type ResponseKind = "response";

export type Hello = { device_id: StableId, hw_rev: string, fw_version: string, protocol_version: number, capabilities: Array<StableId>, mute: boolean, };

export type HelloConfig = Record<symbol, never>;

export type HelloAck = { accepted: boolean, session_id?: StableId | null, config: HelloConfig, };

export type Heartbeat = { state: Expression, mute: boolean, uptime_ms: number, };

export type ControlMessage = { "name": "hello", v: ControlVersion, kind: EventKind, id: StableId, ts_ms: number, data: Hello, } | { "name": "hello_ack", v: ControlVersion, kind: ResponseKind, id: StableId, ts_ms: number, data: HelloAck, } | { "name": "heartbeat", v: ControlVersion, kind: EventKind, id: StableId, ts_ms: number, data: Heartbeat, };

export const PACKAGE_VERSION = "0.2.0" as const;

export const PROTOCOL_VERSION = 1 as const;

export const USB = {
  FRAME_VERSION: 1,
  DELIMITER: 0,
  HEADER_LEN: 12,
  CRC_LEN: 4,
  MAX_PAYLOAD_LEN: 1024,
  MAX_DECODED_LEN: 1040,
  MAX_ENCODED_LEN: 1045,
  MAX_WIRE_LEN: 1046,
  VERSION_OFFSET: 0,
  KIND_OFFSET: 1,
  FLAGS_OFFSET: 2,
  RESERVED_OFFSET: 3,
  STREAM_ID_OFFSET: 4,
  SEQUENCE_OFFSET: 6,
  LENGTH_OFFSET: 10,
  CONTROL: 1,
  ROBOT_AUDIO: 2,
  DESKTOP_AUDIO: 3,
} as const;

export const EXPRESSIONS = ["idle", "listening", "thinking", "speaking", "happy", "confused", "error", "muted", "disconnected"] as const satisfies readonly Expression[];

const transitions: Readonly<Record<Expression, readonly Expression[]>> = {
  "idle": ["idle", "listening", "thinking", "happy", "confused", "error", "muted", "disconnected"],
  "listening": ["idle", "listening", "thinking", "error", "muted", "disconnected"],
  "thinking": ["idle", "thinking", "speaking", "happy", "confused", "error", "muted", "disconnected"],
  "speaking": ["idle", "listening", "speaking", "happy", "confused", "error", "muted", "disconnected"],
  "happy": ["idle", "listening", "thinking", "happy", "error", "muted", "disconnected"],
  "confused": ["idle", "listening", "thinking", "confused", "error", "muted", "disconnected"],
  "error": ["idle", "listening", "thinking", "error", "muted", "disconnected"],
  "muted": ["idle", "error", "muted", "disconnected"],
  "disconnected": ["idle", "error", "muted", "disconnected"],
};

export function canTransition(from: Expression, to: Expression): boolean {
  return transitions[from].includes(to);
}

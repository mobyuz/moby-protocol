// Generated from Rust. Run npm run generate; do not edit.

export type StableId = string;

export type Expression = "idle" | "listening" | "thinking" | "speaking" | "happy" | "confused" | "error" | "muted" | "disconnected";

export type ChatRequest = { text: string, };

export type ToolRequest = { "tool": "git_status", project_id: StableId, } | { "tool": "open_app", app_id: StableId, } | { "tool": "open_project", project_id: StableId, } | { "tool": "search_files", project_id: StableId, query_id: StableId, } | { "tool": "create_reminder", reminder_id: StableId, };

export type ChatResponse = { reply: string, expression: Expression, tool_request?: ToolRequest | null, };

export type ApiError = { code: string, message: string, request_id: string, };

export const PROTOCOL_VERSION = "0.1.0" as const;

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

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

export type LocalTime = string;

export type ConsentType = "terms" | "privacy_policy" | "cloud_voice";

export type UsageInfo = { llm_tokens_remaining: number, stt_seconds_remaining: number, tts_chars_remaining: number, reset_at: ZonedDateTime, };

export type ResourceKind = "app" | "project" | "search_root";

export type ToolResource = { kind: ResourceKind, id: StableId, display_name: string, };

export type AgentMessage = { "kind": "user", text: string, } | { "kind": "assistant", text: string, } | { "kind": "tool_call", call: ToolCall, } | { "kind": "tool_result", result: ToolResult, };

export type AgentTurnRequest = { messages: Array<AgentMessage>, available_tools: Array<ToolName>, resources: Array<ToolResource>, language?: Language | null, script?: Script | null, 
/**
 * The user's current time, so the model can resolve relative reminder
 * times. Absent when the desktop cannot tell.
 */
local_time?: LocalTime | null, };

export type AgentTurnResponse = { "event": "speech_delta", text: string, } | { "event": "tool_call", call: ToolCall, } | { "event": "completed", speech_text: string, display_text?: string | null, expression_hint: Expression, } | { "event": "error", error: ApiError, };

export type ControlVersion = number;

export type EventKind = "event";

export type CommandKind = "command";

export type ResponseKind = "response";

export type Empty = Record<symbol, never>;

export type ErrorCode = "E_PROTO_VERSION" | "E_BAD_FRAME" | "E_CRC" | "E_STATE" | "E_MUTED" | "E_BUSY" | "E_AUDIO_OVERRUN" | "E_TIMEOUT" | "E_UNSUPPORTED" | "E_HW";

export type ErrorDetail = string;

export type VersionText = string;

export type ScreenText = string;

export type AudioStreamId = number;

export type ActionDurationMs = number;

export type TextTtlMs = number;

export type PairTimeoutMs = number;

export type SampleRate = number;

export type ChannelCount = number;

export type FrameMs = number;

export type PrerollMs = number;

export type Percent = number;

export type VadSilenceMs = number;

export type MaxUtteranceMs = number;

export type Nonce = string;

export type Proof = string;

export type PairKey = string;

export type Capabilities = Array<StableId>;

export type ErrorInfo = { code: ErrorCode, detail: ErrorDetail, };

export type DeviceConfig = { wake_sensitivity?: Percent | null, speaker_volume?: Percent | null, vad_silence_ms?: VadSilenceMs | null, max_utterance_ms?: MaxUtteranceMs | null, };

export type Hello = { device_id: StableId, hw_rev: VersionText, fw_version: VersionText, protocol_version: number, capabilities: Capabilities, mute: boolean, 
/**
 * Whether the robot holds a pairing key.
 */
paired: boolean, 
/**
 * Fresh for every hello, so a recorded proof cannot be replayed.
 */
nonce: Nonce, };

export type HelloAck = { accepted: boolean, session_id?: StableId | null, 
/**
 * Present only when the robot reported `paired` and the desktop holds
 * the key.
 */
proof?: Proof | null, config: DeviceConfig, };

export type Heartbeat = { state: Expression, mute: boolean, uptime_ms: number, };

export type WakeDetected = { model_id: StableId, model_version: VersionText, };

export type Button = "talk";

export type ButtonAction = "press" | "release" | "long_press";

export type ButtonEvent = { button: Button, action: ButtonAction, };

export type MuteSource = "switch" | "boot";

export type MuteChanged = { muted: boolean, source: MuteSource, };

export type AudioStartReason = "wake" | "button";

export type AudioCodec = "pcm_s16le";

export type AudioStart = { stream_id: AudioStreamId, reason: AudioStartReason, codec: AudioCodec, sample_rate: SampleRate, channels: ChannelCount, frame_ms: FrameMs, preroll_ms: PrerollMs, };

export type AudioEndReason = "vad_silence" | "max_duration" | "button_release" | "mute" | "cancel" | "error";

export type AudioEnd = { stream_id: AudioStreamId, reason: AudioEndReason, frames: number, duration_ms: number, };

export type SetExpression = { state: Expression, 
/**
 * An animation the firmware knows by name. Unknown names get `E_UNSUPPORTED`.
 */
animation: StableId, duration_ms: ActionDurationMs, };

export type DisplayText = { text: ScreenText, ttl_ms: TextTtlMs, };

export type AudioPlay = { stream_id: AudioStreamId, codec: AudioCodec, sample_rate: SampleRate, };

export type Cancel = { stream_id: AudioStreamId, };

export type ServoPose = { 
/**
 * A pose the firmware knows by name. Unknown names get `E_UNSUPPORTED`.
 */
pose: StableId, duration_ms: ActionDurationMs, };

export type PairBegin = { timeout_ms: PairTimeoutMs, };

export type PairSetKey = { pair_key: PairKey, };

export type ControlMessage = { "name": "hello", v: ControlVersion, kind: EventKind, id: StableId, ts_ms: number, data: Hello, } | { "name": "heartbeat", v: ControlVersion, kind: EventKind, id: StableId, ts_ms: number, data: Heartbeat, } | { "name": "wake_detected", v: ControlVersion, kind: EventKind, id: StableId, ts_ms: number, data: WakeDetected, } | { "name": "button_event", v: ControlVersion, kind: EventKind, id: StableId, ts_ms: number, data: ButtonEvent, } | { "name": "mute_changed", v: ControlVersion, kind: EventKind, id: StableId, ts_ms: number, data: MuteChanged, } | { "name": "audio_start", v: ControlVersion, kind: EventKind, id: StableId, ts_ms: number, data: AudioStart, } | { "name": "audio_end", v: ControlVersion, kind: EventKind, id: StableId, ts_ms: number, data: AudioEnd, } | { "name": "error", v: ControlVersion, kind: EventKind, id: StableId, ts_ms: number, data: ErrorInfo, } | { "name": "pair_button_confirmed", v: ControlVersion, kind: EventKind, id: StableId, ts_ms: number, data: Empty, } | { "name": "pair_reset", v: ControlVersion, kind: EventKind, id: StableId, ts_ms: number, data: Empty, } | { "name": "hello_ack", v: ControlVersion, kind: ResponseKind, id: StableId, ts_ms: number, data: HelloAck, } | { "name": "expression", v: ControlVersion, kind: CommandKind, id: StableId, ts_ms: number, data: SetExpression, } | { "name": "display_text", v: ControlVersion, kind: CommandKind, id: StableId, ts_ms: number, data: DisplayText, } | { "name": "audio_play_start", v: ControlVersion, kind: CommandKind, id: StableId, ts_ms: number, data: AudioPlay, } | { "name": "audio_play_end", v: ControlVersion, kind: CommandKind, id: StableId, ts_ms: number, data: AudioPlay, } | { "name": "cancel", v: ControlVersion, kind: CommandKind, id: StableId, ts_ms: number, data: Cancel, } | { "name": "set_config", v: ControlVersion, kind: CommandKind, id: StableId, ts_ms: number, data: DeviceConfig, } | { "name": "servo_pose", v: ControlVersion, kind: CommandKind, id: StableId, ts_ms: number, data: ServoPose, } | { "name": "pair_begin", v: ControlVersion, kind: CommandKind, id: StableId, ts_ms: number, data: PairBegin, } | { "name": "pair_set_key", v: ControlVersion, kind: CommandKind, id: StableId, ts_ms: number, data: PairSetKey, } | { "name": "command_ok", v: ControlVersion, kind: ResponseKind, id: StableId, ts_ms: number, data: Empty, } | { "name": "command_error", v: ControlVersion, kind: ResponseKind, id: StableId, ts_ms: number, data: ErrorInfo, };

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

export const CONTROL_MESSAGES = [
  { name: "hello", kind: "event", sender: "robot" },
  { name: "heartbeat", kind: "event", sender: "robot" },
  { name: "wake_detected", kind: "event", sender: "robot" },
  { name: "button_event", kind: "event", sender: "robot" },
  { name: "mute_changed", kind: "event", sender: "robot" },
  { name: "audio_start", kind: "event", sender: "robot" },
  { name: "audio_end", kind: "event", sender: "robot" },
  { name: "error", kind: "event", sender: "robot" },
  { name: "pair_button_confirmed", kind: "event", sender: "robot" },
  { name: "pair_reset", kind: "event", sender: "robot" },
  { name: "hello_ack", kind: "response", sender: "desktop" },
  { name: "expression", kind: "command", sender: "desktop" },
  { name: "display_text", kind: "command", sender: "desktop" },
  { name: "audio_play_start", kind: "command", sender: "desktop" },
  { name: "audio_play_end", kind: "command", sender: "desktop" },
  { name: "cancel", kind: "command", sender: "desktop" },
  { name: "set_config", kind: "command", sender: "desktop" },
  { name: "servo_pose", kind: "command", sender: "desktop" },
  { name: "pair_begin", kind: "command", sender: "desktop" },
  { name: "pair_set_key", kind: "command", sender: "desktop" },
  { name: "command_ok", kind: "response", sender: "robot" },
  { name: "command_error", kind: "response", sender: "robot" },
] as const;

export const ERROR_CODES = ["E_PROTO_VERSION", "E_BAD_FRAME", "E_CRC", "E_STATE", "E_MUTED", "E_BUSY", "E_AUDIO_OVERRUN", "E_TIMEOUT", "E_UNSUPPORTED", "E_HW"] as const satisfies readonly ErrorCode[];

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

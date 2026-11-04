# Protocol 0.2.0

Rust definitions in `src/` are authoritative. Generated schemas use JSON Schema
2020-12 in deserialization mode, include `x-package-version`, and reject extra
object fields. The JSON contract uses snake_case.

## Stable IDs and tool fields

An ID is 1-64 ASCII characters, begins with `a`-`z`, and then contains only
lowercase letters, digits, `_`, or `-`. Both construction and deserialization
validate it. Paths, dotted names, URIs, percent escapes, whitespace, Unicode,
and shell syntax are rejected. Schema validation uses a strict end-of-input
assertion to reject final newlines too. Desktop registries can expose lowercase
UUIDs with a type prefix such as `proj_`, `app_`, or `root_`. For example,
`proj_123e4567-e89b-42d3-a456-426614174000` works regardless of the UUID's
initial character.

| Tool | Fields | Local behavior |
| --- | --- | --- |
| `git_status` | `project_id` | Allowlisted project |
| `open_app` | `app_id` | Allowlisted application |
| `open_project` | `project_id`, optional `app_id` | Allowlisted project and optional editor |
| `search_files` | `root_id`, `query`, `max_results` | Literal filename search within a registered root |
| `create_reminder` | `text`, `due_at` | Local reminder with on-screen confirmation |

Every row also requires the `tool` discriminator. Unknown tools, missing fields,
additional fields, and invalid IDs fail Rust deserialization and JSON Schema
validation. The desktop checks local registry membership and permissions and
collects on-screen confirmation where required before invoking any executor.
An omitted or null `app_id` selects the desktop's default handling.

`query` accepts 1–100 Unicode code points and `max_results` accepts integers
from 1 to 50. The query rejects slash, backslash, colon, control characters and
the strings `.` and `..`. Match the query literally against a filename. Resolve
the search path exclusively from the local `root_id` registry.

`text` for a reminder accepts 1–200 Unicode code points. `due_at` uses RFC 3339
with seconds and a UTC designator or explicit numeric offset. Fractional seconds
can carry up to nine digits. Leap seconds are excluded. Enable full `date-time`
format validation in JSON Schema validators, for example with `ajv-formats`.

## Agent turn

`AgentTurnRequest` carries the message history, the names of available tools,
and optional language and script hints. Its `resources` list describes the
desktop's advertised resources by `kind`, `id`, and `display_name`. The kinds
`app`, `project`, and `search_root` map to `app_id`, `project_id`, and `root_id`.
Send labels and registry IDs. Keep actual paths in the desktop registry.

`AgentTurnResponse` describes one JSON stream event. A response can send zero
or more `speech_delta` events, then exactly one terminal `completed`,
`tool_call`, or `error` event. On completion, use the final `speech_text`,
optional `display_text`, and `expression_hint`. The desktop applies local
expression policy and respects hardware mute. If a tool call or error ends the
stream, discard any provisional speech from that request.

After a tool call, the desktop appends the call and its `ToolResult` to the
history and sends a fresh request. Use the same `call_id` for the call and
outcome. Treat tool output and resource labels as untrusted data. The API
validates history ordering and correlation and enforces request and output
limits. Keep conversation history on the desktop and process conversation and
tool content in API memory for the duration of the request. Exclude this
content from API logs and storage. The desktop enforces permissions, timeouts,
and confirmation.
HTTP stream framing belongs in the API's OpenAPI contract.

`UsageInfo` exposes remaining LLM tokens, STT seconds, TTS characters, and
the quota reset timestamp. `ConsentType` identifies terms, privacy policy, and
cloud voice consent. See the [decision record](adr/0001-agent-and-tool-wire-contract.md).

## Expressions and transition policy

All state updates may repeat the same state. Error, mute, and disconnection
interrupt any state. A successful reconnect or unmute first goes to `idle`.
Normal text chat follows `idle -> thinking -> speaking -> happy -> idle`.
Error permits a direct retry to thinking or listening. Thinking may finish
directly as happy/confused when no speaking animation is needed.

Rows are the old state; columns are the requested new state. Y is permitted:

| From / To | idle | listening | thinking | speaking | happy | confused | error | muted | disconnected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| idle | Y | Y | Y | - | Y | Y | Y | Y | Y |
| listening | Y | Y | Y | - | - | - | Y | Y | Y |
| thinking | Y | - | Y | Y | Y | Y | Y | Y | Y |
| speaking | Y | Y | - | Y | Y | Y | Y | Y | Y |
| happy | Y | Y | Y | - | Y | - | Y | Y | Y |
| confused | Y | Y | Y | - | - | Y | Y | Y | Y |
| error | Y | Y | Y | - | - | - | Y | Y | Y |
| muted | Y | - | - | - | - | - | Y | Y | Y |
| disconnected | Y | - | - | - | - | - | Y | Y | Y |

`can_transition` is pure and has no network dependency. The generated npm
`canTransition` derives its table from that function. Shared fixtures independently
specify every pair and are tested by both languages. Offline rendering and
connection detection are consumer responsibilities, using `disconnected` locally.

## Versions and compatibility

`PACKAGE_VERSION` matches Cargo, npm, and the semver release tag. Generated
schemas carry it as `x-package-version`. `PROTOCOL_VERSION` is the integer
for the desktop and robot handshake. Change it when the device wire contract
breaks. HTTP route versions are set by the API.

Changing field names, required fields, enum variants, ID validation, rejected
extra fields, or the transition policy may break consumers. All such breaking
changes require a major bump per the cross-repository project rule, including
the first breaking change after 0.1.0. Generate new artifacts and upgrade each
consumer through its own pinned-dependency PR. Never move published tags or
replace an existing npm version.

TypeScript is structurally typed: an ID is generated as `string`, and extra
properties can pass through variables. TS annotations cannot replace runtime
validation. Send integer counts in plain integer notation. Rust validates the
decoded numeric type, while JSON Schema sees only the parsed JavaScript number.
Rust's Serde decoder also rejects duplicate fields in known variants. JSON
Schema sees only the fields retained by the JSON parser.

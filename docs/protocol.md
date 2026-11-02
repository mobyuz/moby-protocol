# Protocol 0.1.0

Rust definitions in `src/` are authoritative. Generated schemas use JSON Schema
2020-12 in deserialization mode, include `x-protocol-version`, and reject extra
object fields. The JSON contract uses snake_case.

## Stable IDs and tool fields

An ID is 1-64 ASCII characters, begins with `a`-`z`, and then contains only
lowercase letters, digits, `_`, or `-`. Both construction and deserialization
validate it. Paths, dotted names, URIs, percent escapes, whitespace, Unicode,
and shell syntax are rejected. Schema validation uses a strict end-of-input
assertion to reject final newlines too. The private inner string prevents Rust
callers from constructing invalid IDs without the validator.

| Tool | Required fields | Local resolution |
| --- | --- | --- |
| `git_status` | `project_id` | Allowlisted project |
| `open_app` | `app_id` | Allowlisted application |
| `open_project` | `project_id` | Allowlisted project |
| `search_files` | `project_id`, `query_id` | Project plus registered saved search |
| `create_reminder` | `reminder_id` | Registered reminder definition |

Every row also requires the `tool` discriminator. Unknown tools, missing fields,
additional fields, and invalid IDs fail Rust deserialization and JSON Schema
validation. Valid syntax does not establish registry membership or permission.
Desktop consumers must independently check the allowlist and project registry.
All real executors remain outside this repository.

The IDs for saved searches and reminders are a deliberate initial constraint:
v0.1.0 carries no free-form query, title, due time, command, or raw path in a tool
request. A future expansion needs an explicit reviewed contract and version
decision. `ChatRequest.text` and `ChatResponse.reply` remain free-form chat text;
they must never be interpreted as commands.

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

`PROTOCOL_VERSION` is the full semver package version, not an inferred server
version. It is exported by Rust and npm and attached to generated schemas.
HTTP version negotiation is left for the API contract; no unrequested wire
fields have been added to chat envelopes.

Changing field names, required fields, enum variants, ID validation, rejected
extra fields, or the transition policy may break consumers. All such breaking
changes require a major bump per the cross-repository project rule, including
the first breaking change after 0.1.0. Generate new artifacts and upgrade each
consumer through its own pinned-dependency PR. Never move published tags or
replace an existing npm version.

TypeScript is structurally typed: an ID is generated as `string`, and extra
properties can pass through variables. TS annotations cannot replace runtime
validation. Schema validation occurs after JSON parsing and cannot detect
duplicate JSON keys that a parser discarded; Rust's Serde decoder rejects
duplicate fields in known variants.

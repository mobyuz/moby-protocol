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
and optional language, script, and `local_time` hints. Its `resources` list describes the
desktop's advertised resources by `kind`, `id`, and `display_name`. The kinds
`app`, `project`, and `search_root` map to `app_id`, `project_id`, and `root_id`.
Send labels and registry IDs. Keep actual paths in the desktop registry.

`local_time` is the user's current time, for example
`2026-11-05T09:30:00+05:00`. It uses the same RFC 3339 profile as `due_at`: an
explicit numeric offset or `Z` is required, at most nine fractional digits, and
at most 35 characters. A value without an offset, a bare date, or free text is
rejected, as is an unknown sibling field such as a time zone name. The desktop
sets it on every request when it can read its clock; without it the model has
no clock and cannot work out a zoned `due_at` from "in an hour" or "tomorrow".
The API treats the value as data and does not log it. It is optional, and a
request without it stays valid.

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

## USB control messages

Frames follow the [USB v1 decision record](adr/0003-usb-v1-host-framing.md).
A control frame carries one JSON envelope:

```json
{"v":1,"kind":"event","name":"heartbeat","id":"e-0002","ts_ms":2010,"data":{"state":"idle","mute":false,"uptime_ms":2010}}
```

`v` is `1`. `kind` is `event`, `command`, or `response`, and `name` selects the
payload. `id` is a registry ID and `ts_ms` is an unsigned 32-bit counter.
Unknown names, extra fields at either level, and a `kind` that does not belong
to the `name` are rejected. A duplicate field fails in Rust only, as with the
tool types. The robot sends events; the desktop sends commands. The longest
valid message, a `hello` with eight 64-character capabilities, fits the
1024-byte payload limit.

| Name | Kind | Sender | Data |
| --- | --- | --- | --- |
| `hello` | event | robot | `device_id`, `hw_rev`, `fw_version`, `protocol_version`, `capabilities`, `mute`, `paired`, `nonce` |
| `hello_ack` | response | desktop | `accepted`, optional `session_id`, optional `proof`, `config` |
| `heartbeat` | event | robot | `state`, `mute`, `uptime_ms` |
| `wake_detected` | event | robot | `model_id`, `model_version` |
| `button_event` | event | robot | `button` (`talk`), `action` (`press`, `release`, `long_press`) |
| `mute_changed` | event | robot | `muted`, `source` (`switch`, `boot`) |
| `audio_start` | event | robot | `stream_id`, `reason` (`wake`, `button`), `codec`, `sample_rate`, `channels`, `frame_ms`, `preroll_ms` |
| `audio_end` | event | robot | `stream_id`, `reason`, `frames`, `duration_ms` |
| `error` | event | robot | `code`, `detail` |
| `expression` | command | desktop | `state`, `animation`, `duration_ms` |
| `display_text` | command | desktop | `text`, `ttl_ms` |
| `audio_play_start`, `audio_play_end` | command | desktop | `stream_id`, `codec`, `sample_rate` |
| `cancel` | command | desktop | `stream_id` |
| `set_config` | command | desktop | optional `wake_sensitivity`, `speaker_volume`, `vad_silence_ms`, `max_utterance_ms` |
| `servo_pose` | command | desktop | `pose`, `duration_ms` |
| `pair_begin` | command | desktop | `timeout_ms` |
| `pair_set_key` | command | desktop | `pair_key` |
| `pair_button_confirmed`, `pair_reset` | event | robot | none |
| `command_ok` | response | robot | none |
| `command_error` | response | robot | `code`, `detail` |

### Desktop keepalive

The robot sends a `heartbeat` every 2 s. It ends the session after three of its
heartbeats pass with no valid frame from the desktop, about 8 s. While
connected, the desktop must therefore send a frame at least every 2 s. Any
valid frame counts, so a command already in flight is enough. With nothing else
to send, the desktop sends an empty `set_config` (`"data":{}`), which changes
no setting. The robot answers `command_ok`, and the desktop ignores it. Like any
command it carries a fresh `id`, and a `command_error` is not expected. After the
robot ends a session, the desktop starts over with a new `hello` exchange.

Every command gets exactly one response from the robot with the command's `id`:
`command_ok`, or `command_error` with an error code. The `error` event name was
already taken by the robot's unsolicited errors, so responses use the
`command_` prefix. `hello_ack` answers the `hello` event with its `id`.

`audio_end.reason` is `vad_silence`, `max_duration`, `button_release`, `mute`,
`cancel`, or `error`. The only codec is `pcm_s16le`. `animation` and `pose`
are IDs the firmware knows by name; an unknown one gets `E_UNSUPPORTED`. The
`hello_ack` `config` and `set_config` share one object. The robot applies the
fields present and keeps the rest; null counts as absent.

Error codes are `E_PROTO_VERSION`, `E_BAD_FRAME`, `E_CRC`, `E_STATE`,
`E_MUTED`, `E_BUSY`, `E_AUDIO_OVERRUN`, `E_TIMEOUT`, `E_UNSUPPORTED`, and
`E_HW`. `detail` is for people and never carries a key or proof.

Rust validates every bound when it decodes, and JSON Schema states the same
bounds. Ranges are inclusive:

| Field | Range |
| --- | --- |
| `stream_id` | 1–65535 |
| `sample_rate` | 8000–48000 Hz |
| `channels` | 1–2 |
| `frame_ms` | 10–60 |
| `preroll_ms` | 0–2000 |
| `duration_ms` (`expression`, `servo_pose`) | 0–60000 |
| `ttl_ms` | 100–60000 |
| `timeout_ms` | 1000–30000 |
| `wake_sensitivity`, `speaker_volume` | 0–100 |
| `vad_silence_ms` | 200–5000 |
| `max_utterance_ms` | 1000–60000 |
| `display_text.text` | 1–64 code points, no control characters |
| `error.detail` | 1–128 code points, no control characters |
| `hw_rev`, `fw_version`, `model_version` | 1–32 printable ASCII characters, no space |
| `capabilities` | at most 8 registry IDs |
| `frames`, `duration_ms` (`audio_end`), `uptime_ms`, `ts_ms`, `protocol_version` | unsigned 32-bit |

The range checks cannot see that one PCM frame must fit the 1024-byte payload
limit; the sender picks parameters accordingly, and `AudioStart::frame_bytes`
computes the size (640 for 16 kHz mono at 20 ms).

### Pairing and session authentication

See the [decision record](adr/0004-pairing-and-session-auth.md) for the
reasons. Keys, nonces, and proofs are lowercase hexadecimal: a nonce is 16
bytes (32 digits), and a `pair_key` and a `proof` are 32 bytes (64 digits).

1. The robot makes a random 128-bit `device_id` on first boot. Its `hello`
   carries `paired` (whether it holds a key) and a fresh random `nonce`.
2. The desktop answers with `hello_ack`. A `session_id` admits the session.
   When the robot reported `paired` and the desktop holds the key, the ack
   also carries `proof = HMAC-SHA256(pair_key, nonce || device_id || 0x00 ||
   session_id)`: the 16 nonce bytes, the device ID text, one zero byte, and the
   session ID text. An unpaired robot gets no proof.
3. A paired robot checks the proof in constant time. A bad or missing proof
   leaves the session unauthenticated and the robot sends `error` with
   `E_STATE`. An unauthenticated session cannot start audio: the robot sends no
   `audio_start`, and `audio_play_start` gets `E_STATE`.
4. To pair, the desktop asks the user on screen, then sends `pair_begin` with a
   timeout of at most 30 s. An unpaired idle robot answers `command_ok` and
   waits for a talk-button press. A paired robot answers `E_STATE` and one
   already waiting answers `E_BUSY`.
5. The press produces `pair_button_confirmed` instead of audio. If the window
   ends first, the robot sends `error` with `E_TIMEOUT`.
6. The desktop makes 32 random bytes and sends `pair_set_key`. The robot
   accepts it only after the button confirmation, stores it, answers
   `command_ok`, and treats the session as authenticated. Otherwise it answers
   `E_STATE`.
7. A 10 s long press wipes the key. The robot sends `pair_reset`, becomes
   unpaired, and the session becomes unauthenticated. The desktop forgets its
   copy.

The key travels once over USB without encryption and the robot is not
authenticated to the desktop; see the decision record for the limits. `PairKey`
prints as `PairKey(<redacted>)` in `Debug` output and never in errors.
`tests/fixtures/proof-vectors.tsv` and `hmac-vectors.tsv` hold vectors for
firmware to check its mbedTLS code against. The key in those files is test-only.

### C codec

`include/moby_usb_codec.h` and `c/moby_usb_codec.c` implement CRC-32, COBS,
the bounded streaming decoder, frame parse and build, ID and hex checks, and
the proof input for firmware and host tests. They use no heap and no JSON;
firmware parses control JSON with cJSON and computes HMAC with mbedTLS. The
generated `include/moby_usb.h` holds the field bounds, message names, error
code strings, an expression enum, and `moby_can_transition`, all from Rust, so
`npm run generate:check` catches drift. `tests/usb_vectors.c` runs every vector
file listed below.

### Shared vectors

`scripts/make-usb-vectors.mjs` writes these from Node's CRC and HMAC, not from
Rust, and the TypeScript tests fail if the files are stale. Rust, TypeScript,
and C all read them:

| File | Content |
| --- | --- |
| `usb-vectors.tsv` | Frame layout, audio frames, and bad frames |
| `control-vectors.tsv` | Every message name, valid and invalid |
| `cobs-vectors.tsv` | COBS encodings, including 253, 254, and 255-byte runs |
| `hmac-vectors.tsv` | RFC 4231 HMAC-SHA256 cases |
| `proof-vectors.tsv` | Session proof inputs and proofs |
| `transition-vectors.tsv` | The expression transitions, from `wire.json` |

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

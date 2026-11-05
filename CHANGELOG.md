# Changelog

Every release uses the same version in Cargo, npm, PACKAGE_VERSION, generated
schemas, and the `vX.Y.Z` tag. Breaking wire or transition changes require a major
bump, including during 0.x. Each consuming repository upgrades in its own PR.

## [Unreleased]

### Added

- Robot-to-desktop authentication. `hello_ack` gains `desktop_nonce` (16 random
  bytes, lowercase hex), present exactly when `proof` is. A new robot event
  `session_proof` carries the robot's HMAC-SHA256 over
  `"moby-robot-proof-v1" || 0x00 || desktop_nonce || robot_nonce || device_id ||
  0x00 || session_id`, sent only after the desktop proof verified and before any
  audio. A desktop with no valid `session_proof` within 3 s treats the robot as
  unproven and accepts no audio. Library helpers: `robot_proof_input`,
  `PairKey::robot_session_proof`, `PairKey::verify_robot_session_proof`
  (constant time) and `ROBOT_PROOF_LABEL`; C: `moby_robot_proof_input`,
  `MOBY_USB_ROBOT_PROOF_LABEL`. New vectors: `robot-proof-vectors.tsv` and
  `reflection-vectors.tsv`, computed by Node. `PROTOCOL_VERSION` stays 1. See
  [decision 0005](docs/adr/0005-robot-proof-of-key.md).
- Optional `local_time` on `AgentTurnRequest`: the user's current time as an
  RFC 3339 timestamp with a mandatory UTC offset, at most 35 characters, using
  the same validation as the reminder `due_at`. Requests without it stay valid.
  `PROTOCOL_VERSION` stays 1.

### Changed

- `ControlMessage::acknowledge_hello` takes `Option<(&PairKey, Nonce)>`, the
  key with a fresh desktop nonce, instead of `Option<&PairKey>`.
- `hello_ack.proof` no longer accepts `null`; omit it. The control message
  count is 23.

### Documented

- `pair_reset` cannot be authenticated, so a desktop must not delete its stored
  key on it: it marks the pairing stale and asks the user. The same goes for a
  `hello` with `paired: false` from a device ID it holds a key for. A session
  authenticated by `pair_set_key` has no robot proof; the desktop reconnects.
  The old "desktop forgets its copy" wording is removed.
- The desktop keepalive: send a frame at least every 2 s while connected, and
  an empty `set_config` when idle, because the robot ends a session after three
  of its heartbeats (about 8 s) without a valid frame. No wire change.

## [0.2.0] - 2026-11-04

### Added

- The complete USB control message set: robot events (`wake_detected`,
  `button_event`, `mute_changed`, `audio_start`, `audio_end`, `error`),
  desktop commands (`expression`, `display_text`, `audio_play_start`,
  `audio_play_end`, `cancel`, `set_config`, `servo_pose`), and correlated
  `command_ok` and `command_error` responses. Every text, millisecond, rate,
  and percentage field is bounded and validated on deserialize.
- The ten robot error codes.
- Pairing and session authentication: `pair_begin`, `pair_button_confirmed`,
  `pair_set_key`, `pair_reset`, a `paired` flag and `nonce` in `hello`, and an
  HMAC-SHA256 `proof` in `hello_ack`. `PairKey` never appears in `Debug` output.
- Shared test vectors for every message name, positive and negative, plus
  HMAC-SHA256 and COBS vectors. Rust, TypeScript, and C read the same files.
- A dependency-free, allocation-free C codec (`moby_usb_codec`) with CRC-32,
  COBS, a bounded streaming decoder, and frame parsing and building.
- Generated C `moby_can_transition`, expression names, message names, error
  code strings, and field bounds in `moby_usb.h`.

### Changed

- `hello_ack.config` and `set_config` share one `DeviceConfig` type, which
  replaces `HelloConfig`. `ControlMessage::acknowledge_hello` takes the
  optional pair key.
- `hello` requires `paired` and `nonce`.
- `PROTOCOL_VERSION` remains 1 because no robot has shipped.
- New pinned dependencies: `hmac` 0.13.0 and `sha2` 0.11.1.

## [0.1.0] - 2026-11-02

### Added

- Serde wire types for all nine expressions, chat messages, API errors, and the
  five explicitly tagged tool requests.
- Validated stable registry IDs; unknown tools and additional fields are rejected.
- Pure Rust transition policy with all 81 pairs covered by shared wire fixtures.
- Deterministic JSON Schema and TypeScript generation, including a JavaScript
  transition helper and distinct package and device version constants.
- Stateless agent turn and tool result types, language and script values,
  consent types, and remaining usage.
- Bounded filename search and reminder requests, zoned timestamp validation,
  and optional app selection when opening a project.
- Windows/Linux CI checks, tag-triggered GitHub Packages and GitHub Release
  workflow, pinned toolchains, and private-dependency authentication guidance.
- GNU General Public License version 3 (`GPL-3.0-only`).

This entry prepares v0.1.0; it does not assert that the tag or package exists.

# Agent and tool wire contract

Date 2026-11-03

The Moby v1.0 technical plan defines the tool arguments, a stateless agent
turn, and an integer version in the robot handshake. This decision prepares
the unpublished protocol 0.1.0 for those consumers.

Use the plan's bounded filename query and reminder text and timestamp.
Resolve all resource IDs through desktop registries. The previous draft used
saved search and reminder IDs, which required the resources to exist before
users asked for a new search or reminder. Keep the existing opaque ID
syntax and expose a prefixed UUID from the desktop to support identifiers
whose UUID begins with a digit.

Represent the agent response as tagged JSON events. A single response object
would require the provider to finish before emitting partial text. A
stream can emit speech deltas and finish with a completion, an error, or a
tool call. Each call has an opaque ID. The desktop includes the original
call and the matching result in the next stateless request. The API stage
defines how HTTP carries these events and applies semantic limits.

Keep semver in `PACKAGE_VERSION` and use integer `PROTOCOL_VERSION` for
device compatibility. A shared semver string would change every time a
package-only update ships. USB framing and the firmware state machine have
their own implementation stage.

Rust and JSON Schema share fixtures for valid requests and for rejected
paths, malformed dates, and extra fields. The pinned Rust `time` parser
checks calendar dates. The TypeScript tests enable full `date-time`
validation with `ajv-formats`.

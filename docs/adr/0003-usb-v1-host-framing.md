# USB v1 host framing

Date 2026-11-03

Status candidate for host tests and hardware validation in F3.

Use standard COBS with a trailing `0x00` on USB. A length prefix alone makes
recovery depend on an uncorrupted length or a separate synchronization marker.
With COBS, the next zero terminates the damaged segment and the decoder can
start again. [COBS specification](https://stuartcheshire.org/papers/COBSforSIGCOMM/)

Use CRC-32/ISO-HDLC over the decoded header and payload. It uses the reflected
polynomial `0xEDB88320`, initial value `0xFFFFFFFF`, and final XOR
`0xFFFFFFFF`. The check value for `123456789` is `0xCBF43926`. Both the checksum
trailer and the multibyte header fields are little-endian. Pairing supplies
device authentication separately. [zlib CRC-32](https://zlib.net/manual.html)

| Offset | Bytes | Field |
| --- | --- | --- |
| 0 | 1 | Frame format version, initially `1` |
| 1 | 1 | Frame kind, `1` control, `2` robot audio, `3` desktop audio |
| 2 | 1 | Flags, zero |
| 3 | 1 | Reserved, zero |
| 4 | 2 | Stream ID, zero for control and nonzero for audio |
| 6 | 4 | Sequence counter for the stream |
| 10 | 2 | Payload length in bytes |
| 12 | length | UTF-8 control JSON or audio bytes |
| 12 + length | 4 | CRC-32 |

Start host testing with a 1024-byte payload cap. It accommodates the plan's
640-byte PCM chunk and yields at most 1040 decoded bytes and 1046 wire bytes
including the delimiter. Ignore empty segments. When an encoded segment
exceeds the limit, discard it through the next delimiter. The decoder checks
exact length, checksum, version, reserved bytes, frame kind and stream ID.
Transport and session code tracks sequence continuity and timeouts.

Control envelopes use `v = 1`. The robot sends `hello` and `heartbeat` as
events. The desktop responds to `hello` with `hello_ack` and the same `id`.
The hello payload advertises the numeric `protocol_version` and capability
IDs. The desktop rejects incompatible versions and supplies a session ID
only when local admission allows the device. The first configuration object
is empty. A positive response needs a matching ID and a session ID. Heartbeat
reports the display state, the hardware mute state and uptime. Millisecond
counters are unsigned 32-bit values.

The host slice validates framing and the three control messages. F3 validates
the USB controller, timing and reconnect behavior on hardware. Pairing,
commands, PCM stream state and the hardware mute gate belong to later
integration work. The full release needs parser fuzzing and firmware host
validation.

Rust provides framing constants for the generated TypeScript and C files.
The three host tests read the same checked-in wire vectors. Rust dependencies
are pinned to [cobs 0.5.1](https://docs.rs/cobs/0.5.1/cobs/) and
[crc32fast 1.5.3](https://crates.io/crates/crc32fast/1.5.3).

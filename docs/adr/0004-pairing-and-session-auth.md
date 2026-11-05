# Pairing and session authentication

Date 2026-11-04

Status candidate for host tests and hardware validation in F3.

The Moby plan describes pairing in prose: the robot makes a random 128-bit
device ID on first boot, the desktop asks the user and requires a talk-button
press within 30 s, the desktop makes a random 32-byte key that both sides
store, a 10 s long press wipes pairing, and audio starts only on an
authenticated session. It defines no messages. This decision adds them to the
unpublished protocol 0.2.0. `PROTOCOL_VERSION` stays 1 because no robot has
shipped.

## Alternatives

- Trust the USB port. Any local process could open the serial port and start
  audio or play sound. Rejected because the plan requires authentication.
- A separate challenge command after `hello_ack`. It adds a message pair, a
  state, and a round trip. The `hello` already starts every connection, so a
  nonce there is fresh per connection at no extra cost. Rejected.
- Public-key pairing, for example Ed25519. It removes the key transfer but
  needs more firmware code and the plan fixes a 32-byte shared key. Rejected
  for this stage.
- Hex nonce text as the MAC input. Raw bytes are shorter and unambiguous, and
  firmware has to decode the nonce anyway. Rejected.

## Choice

Use the plan's minimal design: command `pair_begin {timeout_ms}`, event
`pair_button_confirmed`, command `pair_set_key {pair_key}`, event `pair_reset`.
`hello` gains `paired` and a random 16-byte `nonce`; `hello_ack` gains an
optional `proof`, omitted when the robot is unpaired. The proof is
HMAC-SHA256 with the pair key. [HMAC](https://www.rfc-editor.org/rfc/rfc2104)
and [its SHA-256 test vectors](https://www.rfc-editor.org/rfc/rfc4231) are
standard, and mbedTLS provides it on the ESP32-S3. The flow and robot rules are
in [protocol.md](../protocol.md).

Three adjustments to the proposal:

1. The MAC input is `nonce || device_id || 0x00 || session_id`, with a zero
   byte between the two IDs. Both IDs have variable length, so without a
   separator the device `ab` with session `c` has the same input as device `a`
   with session `bc`. A registry ID cannot contain a zero byte, so the
   separator is unambiguous. The proof vectors include that pair.
2. Responses to commands are `command_ok` and `command_error`. The name
   `error` already identifies the robot's unsolicited error event, and the
   name selects the payload, so a response needs its own name. Both carry the
   plan's error codes.
3. A bad proof gets the plan's `E_STATE` code, sent as an `error` event,
   because the plan's code list has no authentication code and a response
   cannot answer a response. `hello_ack` and `set_config` share one
   `DeviceConfig` object, replacing the empty `HelloConfig`.

After a successful `pair_set_key` the robot treats that session as
authenticated. The key arrived with a physical confirmation on this session,
so asking the desktop to reconnect would add nothing.

## Consequences and limits

- The key crosses the USB cable once in clear text. The button press stops a
  host process from pairing silently, but not a bus tap or a process that can
  already read the desktop's key store.
- Superseded by [0005](0005-robot-proof-of-key.md): the proof here
  authenticates the desktop to the robot only, and 0005 adds the robot's proof
  back. Later frames still carry no MAC. The nonce stops
  replay of a recorded `hello_ack` on a new connection; it does not protect
  traffic within a session.
- `PairKey` stores its hex text, compares in constant time, and prints as
  `PairKey(<redacted>)` in `Debug` output. It serializes in full, because
  `pair_set_key` must send it. It is not zeroized on drop; the desktop should
  keep the key in the operating system's credential store.
- The library makes no random bytes. The robot supplies the nonce and the
  desktop supplies the key.
- Rust uses RustCrypto [hmac 0.13.0](https://docs.rs/hmac/0.13.0/hmac/) and
  [sha2 0.11.1](https://docs.rs/sha2/0.11.1/sha2/), pinned with locked
  versions, as the other dependencies are.

## Evidence

The Rust tests compute the six RFC 4231 cases through `hmac` and `sha2`, and
the four session proofs through `PairKey::session_proof`. The TypeScript test
recomputes both files with Node's `createHmac`. The vector script that wrote
them also uses Node, so Rust is checked by an independent implementation. The
tests flip each of the key, nonce, device ID, session ID, and proof, and each
fails verification. Other tests show that `Debug` output of a key, of a
message that holds it, and of an option or list of that message never contains
the key digits. The C test checks the proof input bytes that firmware passes to
mbedTLS. HMAC itself is not in the C codec.

# Robot proof of the pairing key

Date 2026-11-05

Status candidate for host tests and hardware validation in F3. Replaces the
accepted limit "the robot is not authenticated to the desktop" in
[0004](0004-pairing-and-session-auth.md). The owner approved the change on
2026-11-05.

Decision 0004 proves the desktop to the robot only. A USB device that copies the
robot's public device ID is therefore taken for that robot: its audio would be
uploaded and fed to the agent. Protocol 0.2.0 is unreleased and no robot has
shipped, so `PROTOCOL_VERSION` stays 1.

## Choice

- \`hello_ack\` gains \`desktop_nonce\`: 16 random bytes as lowercase hexadecimal,
  in the same style as \`hello.nonce\`. It is present exactly when \`proof\` is,
  and neither may be \`null\`. Rust rejects one without the other and the schema
  states it with \`dependentRequired\`.
- A new robot event \`session_proof\` carries \`proof\`, the lowercase hexadecimal of
  \`HMAC-SHA256(pair_key, "moby-robot-proof-v1" || 0x00 || desktop_nonce ||
  robot_nonce || device_id || 0x00 || session_id)\`. The nonces are 16 raw bytes
  each, the IDs are text, and the existing desktop proof input does not change.
- The robot sends it only after the desktop proof verified, as the first event
  after that and before any audio can start. A bad or missing desktop proof
  produces nothing, so an unauthenticated peer receives no HMAC output.
- A desktop that gets no valid \`session_proof\` within 3 s of its \`hello_ack\`
  treats the robot as unproven: it accepts no audio and tells the user. 3 s is
  the handshake window; the robot's own session timeout is about 8 s, so the
  desktop decides first.
- \`pair_reset\` cannot be authenticated, because the robot has just erased its
  key. A desktop must not delete its key on \`pair_reset\` alone. It marks the
  pairing stale and asks the user. A \`hello\` with \`paired: false\` from a device
  ID the desktop holds a key for is treated the same way.

## Why the label, and why neither proof can be reflected

Both proofs use the same key. A hostile robot chooses its \`hello\` nonce, so it
could ask the desktop to compute an HMAC over bytes it picked, and a hostile
desktop could try the same against the robot. The robot proof input starts with
\`moby-robot-proof-v1\` and a zero byte; the desktop proof input starts with 16
nonce bytes and then a device ID. A device ID begins with \`a\`-\`z\`, and byte 16
of the robot input is \`-\`, so the two inputs differ at byte 16 at the latest,
even when the hostile side sets its nonce to the first 16 bytes of the label.
Inputs that differ give independent HMACs, so neither proof is valid as the
other. The reflection vectors contain that case. This relies on the ID rule
\`^[a-z]\` staying as it is; the library test asserts \`-v1\` is not an ID.

A fresh \`desktop_nonce\` per ack and the robot's fresh \`hello\` nonce make each
robot proof unique to one session, so a recorded one does not replay.

## Alternatives

- Reuse the desktop proof for both directions. Rejected: it is exactly the
  reflection the label prevents.
- A second request and response after the ack. Rejected: it adds a state and a
  round trip, and the proof is already due once the ack is verified.
- Send the robot proof whatever the desktop proof says. Rejected: the robot
  would compute an HMAC for any peer, which is an oracle on the key.

## Consequences and limits

- The first session after pairing (\`pair_set_key\`) has no \`desktop_nonce\`, so it
  carries no robot proof. The desktop treats that session as unproven for audio
  and reconnects; the next session is proven. 0004 said a reconnect adds
  nothing; it now does.
- Pairing itself is still trust on first use: the key crosses the cable once in
  clear text and an unpaired robot cannot be proven. A device that reports
  \`paired: false\` for an ID the desktop knows is handled by the stale rule above.
- Proofs cover the handshake only. Later frames still carry no MAC, so a device
  that takes over the cable after the handshake, or relays both ends, is not
  stopped. A per-frame MAC would need a protocol bump and is out of scope.
- A desktop that never implements the check gets no protection. The rule is a
  desktop obligation, stated in [protocol.md](../protocol.md).
- \`desktop_nonce\` is not covered by the desktop proof. Changing it on the wire
  only makes the robot proof fail at the desktop.
- \`hello_ack.proof\` no longer accepts \`null\`, only absence, which is stricter
  than before. \`ControlMessage::acknowledge_hello\` takes the key together with
  the nonce as \`Option<(&PairKey, Nonce)>\`, because the library makes no random
  bytes.

## Evidence

\`robot-proof-vectors.tsv\` is computed with Node's \`createHmac\`, not from Rust.
Rust, TypeScript, and C read it; Rust checks the whole proof, TypeScript
recomputes it, and C checks the input bytes that firmware passes to mbedTLS.
\`reflection-vectors.tsv\` holds pairs of desktop and robot inputs, including the
hostile-nonce pair, with the byte where they first differ. Tests flip each of
the key, both nonces, the device ID, the session ID, and the proof, swap the
nonces, and show \`Debug\` output never holds the key.

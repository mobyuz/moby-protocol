import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { crc32 } from "node:zlib";
import Ajv2020 from "ajv/dist/2020.js";
import { CONTROL_MESSAGES, ERROR_CODES, PACKAGE_VERSION, USB } from "@mobyuz/moby-protocol";

async function tsv(name) {
  const text = await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
  return text.trimEnd().split(/\r?\n/).filter((line) => !line.startsWith("#")).map((line) => line.split("\t"));
}
const rows = await tsv("usb-vectors.tsv");
const controlRows = await tsv("control-vectors.tsv");

// Returns the decoded bytes, or null when the COBS data is malformed.
function cobsDecode(encoded) {
  const raw = Buffer.alloc(USB.MAX_DECODED_LEN);
  let length = 0;
  for (let offset = 0; offset < encoded.length;) {
    const code = encoded[offset++];
    const end = offset + code - 1;
    const addZero = code !== 0xff && end < encoded.length;
    if (code === 0 || end > encoded.length || length + code - 1 + Number(addZero) > raw.length) {
      return null;
    }
    length += encoded.copy(raw, length, offset, end);
    if (addZero) raw[length++] = USB.DELIMITER;
    offset = end;
  }
  return raw.subarray(0, length);
}

function decodeFrame(wire) {
  if (wire.length > USB.MAX_WIRE_LEN || wire.at(-1) !== USB.DELIMITER) {
    return "bad_frame";
  }
  const encoded = wire.subarray(0, -1);
  if (encoded.includes(USB.DELIMITER)) return "bad_frame";
  const raw = cobsDecode(encoded);
  if (raw === null) return "bad_frame";
  const length = raw.length;

  if (length < USB.HEADER_LEN + USB.CRC_LEN) return "bad_frame";
  const payloadLength = raw.readUInt16LE(USB.LENGTH_OFFSET);
  const bodyEnd = USB.HEADER_LEN + payloadLength;
  if (payloadLength > USB.MAX_PAYLOAD_LEN || length !== bodyEnd + USB.CRC_LEN) {
    return "bad_frame";
  }
  if (raw.readUInt32LE(bodyEnd) !== crc32(raw.subarray(0, bodyEnd))) return "bad_crc";
  if (raw[USB.VERSION_OFFSET] !== USB.FRAME_VERSION) return "unsupported_version";
  if (raw[USB.FLAGS_OFFSET] !== 0 || raw[USB.RESERVED_OFFSET] !== 0) return "bad_frame";

  const kind = raw[USB.KIND_OFFSET];
  const stream = raw.readUInt16LE(USB.STREAM_ID_OFFSET);
  if (![USB.CONTROL, USB.ROBOT_AUDIO, USB.DESKTOP_AUDIO].includes(kind)) return "bad_frame";
  if ((kind === USB.CONTROL) !== (stream === 0)) return "bad_frame";
  return {
    kind,
    stream,
    sequence: raw.readUInt32LE(USB.SEQUENCE_OFFSET),
    payload: raw.subarray(USB.HEADER_LEN, bodyEnd),
  };
}

const schemaPath = new URL("../schema/usb-control.schema.json", import.meta.url);
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
assert.equal(schema["x-package-version"], PACKAGE_VERSION);
const ajv = new Ajv2020({ strict: true });
ajv.addKeyword({ keyword: "x-package-version", schemaType: "string", valid: true });
const validate = ajv.compile(schema);

const controlJson = (name) => {
  const row = controlRows.find(([candidate]) => candidate === name);
  return JSON.parse(Buffer.from(row[3], "hex").toString("utf8"));
};

// A copy of a vector with one dotted path replaced.
function set(vector, path, value) {
  const message = structuredClone(controlJson(vector));
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((object, key) => object[key], message)[last] = value;
  return message;
}

test("USB wire vectors agree with the generated TypeScript frame layout", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  for (const [name, expected, kind, stream, sequence, payload, wire] of rows) {
    const actual = decodeFrame(Buffer.from(wire, "hex"));
    if (expected === "ok") {
      assert.deepEqual(actual, {
        kind: Number(kind),
        stream: Number(stream),
        sequence: Number(sequence),
        payload: Buffer.from(payload, "hex"),
      }, name);
    } else {
      assert.equal(actual, expected, name);
    }
  }
});

test("COBS vectors decode to their raw bytes", async () => {
  const vectors = await tsv("cobs-vectors.tsv");
  assert.ok(vectors.length >= 16);
  for (const [name, raw, encoded] of vectors) {
    assert.deepEqual(cobsDecode(Buffer.from(encoded, "hex")), Buffer.from(raw, "hex"), name);
  }
});

test("every control vector is framed correctly and validated as labeled", () => {
  for (const [name, verdict, sequence, payload, wire] of controlRows) {
    const frame = decodeFrame(Buffer.from(wire, "hex"));
    assert.deepEqual(frame, {
      kind: USB.CONTROL,
      stream: 0,
      sequence: Number(sequence),
      payload: Buffer.from(payload, "hex"),
    }, name);
    const message = JSON.parse(frame.payload.toString("utf8"));
    assert.equal(validate(message), verdict === "valid", `${name}: ${JSON.stringify(validate.errors)}`);
  }
});

test("every message name has a positive vector and matches the generated catalog", () => {
  assert.equal(CONTROL_MESSAGES.length, 23);
  const valid = controlRows.filter(([, verdict]) => verdict === "valid").map(([name]) => controlJson(name));
  for (const { name, kind, sender } of CONTROL_MESSAGES) {
    const samples = valid.filter((message) => message.name === name);
    assert.ok(samples.length > 0, name);
    for (const message of samples) assert.equal(message.kind, kind, name);
    assert.equal(sender, kind === "event" || name.startsWith("command_") ? "robot" : "desktop", name);
  }
  assert.equal(new Set(CONTROL_MESSAGES.map(({ name }) => name)).size, CONTROL_MESSAGES.length);
  for (const message of valid) {
    assert.ok(CONTROL_MESSAGES.some(({ name }) => name === message.name), message.name);
  }
  assert.deepEqual(ERROR_CODES, [
    "E_PROTO_VERSION", "E_BAD_FRAME", "E_CRC", "E_STATE", "E_MUTED", "E_BUSY",
    "E_AUDIO_OVERRUN", "E_TIMEOUT", "E_UNSUPPORTED", "E_HW",
  ]);
});

test("USB control schema rejects extra fields, other kinds, and missing fields", () => {
  // proof and desktop_nonce are not optional on their own: they go together.
  const optional = ["session_id", "wake_sensitivity", "speaker_volume", "vad_silence_ms", "max_utterance_ms"];
  for (const [name, verdict] of controlRows) {
    if (verdict !== "valid") continue;
    const message = controlJson(name);
    for (const field of ["extra", "pair_key", "path"]) {
      assert.equal(validate({ ...message, [field]: "unexpected" }), false, `${name} envelope ${field}`);
      assert.equal(validate({ ...message, data: { ...message.data, [field]: "unexpected" } }), false, `${name} data ${field}`);
    }
    for (const kind of ["event", "command", "response"]) {
      assert.equal(validate({ ...message, kind }), kind === message.kind, `${name} as ${kind}`);
    }
    for (const key of Object.keys(message)) {
      const { [key]: omitted, ...rest } = message;
      assert.equal(validate(rest), false, `${name} without ${key}`);
    }
    for (const key of Object.keys(message.data)) {
      const { [key]: omitted, ...data } = message.data;
      assert.equal(validate({ ...message, data }), optional.includes(key), `${name} without data.${key}`);
    }
    for (const v of [0, 2, "1", null]) assert.equal(validate({ ...message, v }), false, name);
    assert.equal(validate({ ...message, name: `${message.name}_x` }), false, name);
  }
  for (const name of ["reboot", "Heartbeat", "", "hello_ack\n", null, 7]) {
    assert.equal(validate({ ...controlJson("heartbeat"), name }), false, String(name));
  }
});

test("USB control schema bounds match the Rust types", () => {
  const ranges = [
    ["audio_start", "data.stream_id", 1, 65535],
    ["audio_start", "data.sample_rate", 8000, 48000],
    ["audio_start", "data.channels", 1, 2],
    ["audio_start", "data.frame_ms", 10, 60],
    ["audio_start", "data.preroll_ms", 0, 2000],
    ["audio_play_start", "data.stream_id", 1, 65535],
    ["audio_play_start", "data.sample_rate", 8000, 48000],
    ["cancel", "data.stream_id", 1, 65535],
    ["expression", "data.duration_ms", 0, 60000],
    ["servo_pose", "data.duration_ms", 0, 60000],
    ["display_text", "data.ttl_ms", 100, 60000],
    ["pair_begin", "data.timeout_ms", 1000, 30000],
    ["set_config_maximums", "data.wake_sensitivity", 0, 100],
    ["set_config_maximums", "data.speaker_volume", 0, 100],
    ["set_config_maximums", "data.vad_silence_ms", 200, 5000],
    ["set_config_maximums", "data.max_utterance_ms", 1000, 60000],
    ["heartbeat", "ts_ms", 0, 2 ** 32 - 1],
    ["heartbeat", "data.uptime_ms", 0, 2 ** 32 - 1],
    ["audio_end", "data.frames", 0, 2 ** 32 - 1],
    ["audio_end", "data.duration_ms", 0, 2 ** 32 - 1],
  ];
  for (const [vector, path, min, max] of ranges) {
    for (const value of [min, max]) assert.equal(validate(set(vector, path, value)), true, `${vector} ${path}=${value}`);
    for (const value of [min - 1, max + 1, min + 0.5, String(max), true]) {
      assert.equal(validate(set(vector, path, value)), false, `${vector} ${path}=${value}`);
    }
    // Only the optional configuration fields accept null.
    assert.equal(validate(set(vector, path, null)), vector.startsWith("set_config"), `${vector} ${path}=null`);
  }

  const texts = [
    ["display_text", "data.text", 64], ["error", "data.detail", 128], ["command_error", "data.detail", 128],
    ["hello", "data.fw_version", 32], ["hello", "data.hw_rev", 32], ["wake_detected", "data.model_version", 32],
  ];
  for (const [vector, path, max] of texts) {
    for (const length of [1, max]) assert.equal(validate(set(vector, path, "x".repeat(length))), true, `${vector} ${path}`);
    for (const length of [0, max + 1]) assert.equal(validate(set(vector, path, "x".repeat(length))), false, `${vector} ${path}`);
  }
  // Four-byte characters count once.
  assert.equal(validate(set("display_text", "data.text", "🌐".repeat(64))), true);
  assert.equal(validate(set("display_text", "data.text", "🌐".repeat(65))), false);
  for (const bad of ["a\nb", "a\tb", "\u007f", "\u0085", "a\u0000b"]) {
    assert.equal(validate(set("display_text", "data.text", bad)), false, JSON.stringify(bad));
    assert.equal(validate(set("error", "data.detail", bad)), false, JSON.stringify(bad));
  }
  for (const bad of ["a b", "é", "a\n"]) {
    assert.equal(validate(set("hello", "data.fw_version", bad)), false, JSON.stringify(bad));
  }
  const capabilities = (count) => set("hello", "data.capabilities", Array.from({ length: count }, (_, i) => `cap_${i}`));
  assert.equal(validate(capabilities(8)), true);
  assert.equal(validate(capabilities(9)), false);

  const key = controlJson("pair_set_key").data.pair_key;
  assert.equal(validate(set("pair_set_key", "data.pair_key", key)), true);
  for (const bad of [key.slice(2), key + "00", key.toUpperCase(), "g" + key.slice(1), key + "\n", [1, 2], null]) {
    assert.equal(validate(set("pair_set_key", "data.pair_key", bad)), false, JSON.stringify(bad));
  }

  for (const [vector, path, accepted, rejected] of [
    ["button_event_press", "data.action", ["press", "release", "long_press"], ["Press", "double", ""]],
    ["audio_start", "data.codec", ["pcm_s16le"], ["opus", "PCM_S16LE"]],
    ["audio_end", "data.reason", ["vad_silence", "max_duration", "button_release", "mute", "cancel", "error"], ["wake", "timeout"]],
    ["expression", "data.animation", ["a", "blink_2", "spin-fast"], ["Blink", "../blink", "", "1blink"]],
    ["error", "data.code", ERROR_CODES, ["E_NONE", "e_state", ""]],
    ["command_error", "data.code", ERROR_CODES, ["E_NONE", "state"]],
  ]) {
    for (const value of accepted) assert.equal(validate(set(vector, path, value)), true, `${vector} ${value}`);
    for (const value of rejected) assert.equal(validate(set(vector, path, value)), false, `${vector} ${value}`);
  }
});

test("HMAC and session proof vectors agree with Node's crypto", async () => {
  const hmacs = await tsv("hmac-vectors.tsv");
  assert.equal(hmacs.length, 6);
  for (const [name, key, message, mac] of hmacs) {
    const actual = createHmac("sha256", Buffer.from(key, "hex")).update(Buffer.from(message, "hex")).digest("hex");
    assert.equal(actual, mac, name);
  }
  const proofs = await tsv("proof-vectors.tsv");
  for (const [name, key, nonce, device, session, input, proof] of proofs) {
    const bytes = Buffer.concat([Buffer.from(nonce, "hex"), Buffer.from(device), Buffer.from([0]), Buffer.from(session)]);
    assert.equal(bytes.toString("hex"), input, name);
    assert.equal(createHmac("sha256", Buffer.from(key, "hex")).update(bytes).digest("hex"), proof, name);
  }
  // The hello_ack vector carries the first session proof.
  assert.equal(controlJson("hello_ack_proof").data.proof, proofs[0][6]);
  const proofOf = (name) => proofs.find(([candidate]) => candidate === name)[6];
  assert.notEqual(proofOf("separator_ab_c"), proofOf("separator_a_bc"));
});

test("robot proof and reflection vectors agree with Node's crypto", async () => {
  const label = Buffer.from("moby-robot-proof-v1");
  const robotProofs = await tsv("robot-proof-vectors.tsv");
  assert.ok(robotProofs.length >= 5);
  for (const [name, key, desktopNonce, robotNonce, device, session, input, proof] of robotProofs) {
    const bytes = Buffer.concat([
      label, Buffer.from([0]), Buffer.from(desktopNonce, "hex"), Buffer.from(robotNonce, "hex"),
      Buffer.from(device), Buffer.from([0]), Buffer.from(session),
    ]);
    assert.equal(bytes.toString("hex"), input, name);
    assert.equal(createHmac("sha256", Buffer.from(key, "hex")).update(bytes).digest("hex"), proof, name);
  }
  // The session_proof control vector carries the first robot proof.
  assert.equal(controlJson("session_proof").data.proof, robotProofs[0][7]);
  assert.equal(controlJson("hello_ack_proof").data.desktop_nonce, robotProofs[0][2]);
  const proofOf = (name) => robotProofs.find(([candidate]) => candidate === name)[7];
  assert.notEqual(proofOf("separator_ab_c"), proofOf("separator_a_bc"));
  assert.notEqual(proofOf("robot_proof_1"), proofOf("nonces_swapped"));

  const reflections = await tsv("reflection-vectors.tsv");
  assert.ok(reflections.length >= 3);
  for (const [name, key, desktopInput, desktopProof, robotInput, robotProof, difference] of reflections) {
    const hmac = (hex) => createHmac("sha256", Buffer.from(key, "hex")).update(Buffer.from(hex, "hex")).digest("hex");
    assert.equal(hmac(desktopInput), desktopProof, name);
    assert.equal(hmac(robotInput), robotProof, name);
    assert.notEqual(desktopInput, robotInput, name);
    assert.notEqual(desktopProof, robotProof, name);
    const a = Buffer.from(desktopInput, "hex");
    const b = Buffer.from(robotInput, "hex");
    let first = 0;
    while (first < a.length && first < b.length && a[first] === b[first]) first++;
    assert.equal(first, Number(difference), name);
    assert.ok(first <= 16, name);
  }
});

test("hello_ack requires proof and desktop_nonce together, and neither may be null", () => {
  const ack = controlJson("hello_ack_proof");
  assert.equal(validate(ack), true);
  const without = (field) => ({ ...ack, data: (({ [field]: _, ...rest }) => rest)(ack.data) });
  assert.equal(validate(without("proof")), false);
  assert.equal(validate(without("desktop_nonce")), false);
  assert.equal(validate({ ...ack, data: { ...ack.data, proof: null } }), false);
  assert.equal(validate({ ...ack, data: { ...ack.data, desktop_nonce: null } }), false);
  assert.equal(validate(controlJson("hello_ack")), true);
});

test("checked-in vectors match the generator script", () => {
  const script = fileURLToPath(new URL("../scripts/make-usb-vectors.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

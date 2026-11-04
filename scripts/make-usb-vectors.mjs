// Writes the shared USB control, COBS, and HMAC vectors in tests/fixtures.
// Run `node scripts/make-usb-vectors.mjs` to rewrite them, or add --check to
// compare without writing. Rust, TypeScript, and C all read the output. The
// CRC, COBS, and HMAC here come from Node and this file, not from Rust, so a
// vector that Rust accepts was checked by an independent implementation.
import { createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { crc32 } from "node:zlib";

const check = process.argv.includes("--check");
const fixtures = new URL("../tests/fixtures/", import.meta.url);

// Minimal COBS: a full 0xff block at the end of the input has no trailing 0x01.
function cobsEncode(raw) {
  const out = [0];
  let codeIndex = 0;
  let code = 1;
  for (const byte of raw) {
    if (code === 0xff) {
      out[codeIndex] = code;
      codeIndex = out.push(0) - 1;
      code = 1;
    }
    if (byte === 0) {
      out[codeIndex] = code;
      codeIndex = out.push(0) - 1;
      code = 1;
    } else {
      out.push(byte);
      code++;
    }
  }
  out[codeIndex] = code;
  return Buffer.from(out);
}

function controlFrame(payload, sequence) {
  const header = Buffer.alloc(12);
  header[0] = 1; // frame version
  header[1] = 1; // control
  header.writeUInt32LE(sequence, 6);
  header.writeUInt16LE(payload.length, 10);
  const body = Buffer.concat([header, payload]);
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32LE(crc32(body));
  return Buffer.concat([cobsEncode(Buffer.concat([body, trailer])), Buffer.from([0])]);
}

// Test-only material. Never use this key outside these fixtures.
const KEY = Buffer.from(Array.from({ length: 32 }, (_, index) => index)).toString("hex");
const DEVICE = "dev_123e4567-e89b-42d3-a456-426614174000";
const NONCE = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const NONCE_PAIRED = "00112233445566778899aabbccddeeff";
const SESSION = "session_1";

function proof(nonce, device, session) {
  const input = Buffer.concat([
    Buffer.from(nonce, "hex"), Buffer.from(device), Buffer.from([0]), Buffer.from(session),
  ]);
  return { input, mac: createHmac("sha256", Buffer.from(KEY, "hex")).update(input).digest() };
}

let counter = 0;
function envelope(name, kind, data, extra = {}) {
  counter++;
  const prefix = kind === "event" ? "e" : kind === "command" ? "c" : "r";
  return { v: 1, kind, name, id: `${prefix}-${String(counter).padStart(4, "0")}`, ts_ms: 10 * counter, data, ...extra };
}
const event = (name, data) => envelope(name, "event", data);
const command = (name, data) => envelope(name, "command", data);
const response = (name, data, extra) => envelope(name, "response", data, extra);
// A hello_ack answers the hello with the same ID.
const ack = (helloId, data) => response("hello_ack", data, { id: helloId, ts_ms: 11 });

const hello = {
  device_id: DEVICE, hw_rev: "esp32-s3-r1", fw_version: "0.1.0", protocol_version: 1,
  capabilities: ["usb_pcm"], mute: true, paired: false, nonce: NONCE,
};
const audioStart = {
  stream_id: 1, reason: "wake", codec: "pcm_s16le", sample_rate: 16000, channels: 1,
  frame_ms: 20, preroll_ms: 300,
};
const audioPlay = { stream_id: 2, codec: "pcm_s16le", sample_rate: 16000 };
const showText = { text: "Salom, dunyo 🌐", ttl_ms: 3000 };
const setConfig = { wake_sensitivity: 60, speaker_volume: 35, vad_silence_ms: 800, max_utterance_ms: 15000 };
const errorInfo = { code: "E_STATE", detail: "pairing was not confirmed" };
const withData = (message, patch) => ({ ...message, data: { ...message.data, ...patch } });

const valid = [];
const invalid = [];
const ok = (name, message) => valid.push([name, message]);
const bad = (name, message) => invalid.push([name, message]);

ok("hello", event("hello", hello));
ok("hello_paired", event("hello", { ...hello, paired: true, nonce: NONCE_PAIRED }));
ok("hello_ack", ack("e-0001", { accepted: true, session_id: SESSION, config: {} }));
ok("hello_ack_proof", ack("e-0002", {
  accepted: true, session_id: SESSION, config: {},
  proof: proof(NONCE_PAIRED, DEVICE, SESSION).mac.toString("hex"),
}));
ok("hello_ack_rejected", ack("e-0001", { accepted: false, config: {} }));
ok("heartbeat", event("heartbeat", { state: "muted", mute: true, uptime_ms: 2010 }));
ok("wake_detected", event("wake_detected", { model_id: "hey_moby", model_version: "1.2.0" }));
ok("button_event_press", event("button_event", { button: "talk", action: "press" }));
ok("button_event_long_press", event("button_event", { button: "talk", action: "long_press" }));
ok("mute_changed", event("mute_changed", { muted: true, source: "switch" }));
ok("audio_start", event("audio_start", audioStart));
ok("audio_end", event("audio_end", { stream_id: 1, reason: "vad_silence", frames: 150, duration_ms: 3000 }));
ok("error", event("error", { code: "E_AUDIO_OVERRUN", detail: "ring buffer overrun" }));
ok("pair_button_confirmed", event("pair_button_confirmed", {}));
ok("pair_reset", event("pair_reset", {}));
ok("expression", command("expression", { state: "thinking", animation: "spin", duration_ms: 1500 }));
ok("display_text", command("display_text", showText));
ok("display_text_64_chars", command("display_text", { ...showText, text: "🌐".repeat(64) }));
ok("audio_play_start", command("audio_play_start", audioPlay));
ok("audio_play_end", command("audio_play_end", audioPlay));
ok("cancel", command("cancel", { stream_id: 1 }));
ok("set_config", command("set_config", setConfig));
ok("set_config_empty", command("set_config", {}));
ok("set_config_minimums", command("set_config", {
  wake_sensitivity: 0, speaker_volume: 0, vad_silence_ms: 200, max_utterance_ms: 1000,
}));
ok("set_config_maximums", command("set_config", {
  wake_sensitivity: 100, speaker_volume: 100, vad_silence_ms: 5000, max_utterance_ms: 60000,
}));
ok("servo_pose", command("servo_pose", { pose: "nod", duration_ms: 600 }));
ok("pair_begin", command("pair_begin", { timeout_ms: 30000 }));
ok("pair_set_key", command("pair_set_key", { pair_key: KEY }));
ok("command_ok", response("command_ok", {}));
ok("command_error", response("command_error", errorInfo));

const expression = command("expression", { state: "idle", animation: "blink", duration_ms: 0 });
bad("unknown_name", command("reboot", {}));
bad("unknown_name_wrong_case", event("Heartbeat", { state: "idle", mute: false, uptime_ms: 1 }));
bad("extra_data_field", withData(event("hello", hello), { pair_key: "unexpected" }));
bad("extra_envelope_field", { ...event("heartbeat", { state: "idle", mute: false, uptime_ms: 1 }), extra: 1 });
bad("extra_empty_data_field", event("pair_reset", { reason: "unexpected" }));
bad("missing_data_field", event("hello", (({ nonce, ...rest }) => rest)(hello)));
bad("missing_data", (({ data, ...rest }) => rest)(event("pair_reset", {})));
bad("wrong_kind_command_as_event", { ...expression, kind: "event" });
bad("wrong_kind_event_as_command", { ...event("wake_detected", { model_id: "hey_moby", model_version: "1" }), kind: "command" });
bad("wrong_kind_response_as_event", { ...response("command_ok", {}), kind: "event" });
bad("wrong_kind_command_as_response", { ...command("cancel", { stream_id: 1 }), kind: "response" });
bad("protocol_envelope_v2", { ...event("pair_reset", {}), v: 2 });
bad("hello_paired_not_boolean", withData(event("hello", hello), { paired: "yes" }));
bad("hello_capabilities_9", withData(event("hello", hello), { capabilities: Array.from({ length: 9 }, (_, i) => `cap_${i}`) }));
bad("hello_version_has_space", withData(event("hello", hello), { fw_version: "0.1 0" }));
bad("hello_nonce_short", withData(event("hello", hello), { nonce: NONCE.slice(2) }));
bad("hello_nonce_uppercase", withData(event("hello", hello), { nonce: NONCE.toUpperCase() }));
bad("hello_ack_proof_short", response("hello_ack", { accepted: true, session_id: SESSION, config: {}, proof: "ab".repeat(31) }));
bad("heartbeat_uptime_negative", event("heartbeat", { state: "idle", mute: false, uptime_ms: -1 }));
bad("heartbeat_uptime_overflow", event("heartbeat", { state: "idle", mute: false, uptime_ms: 2 ** 32 }));
bad("heartbeat_unknown_state", event("heartbeat", { state: "asleep", mute: false, uptime_ms: 1 }));
bad("button_unknown_action", event("button_event", { button: "talk", action: "double" }));
bad("mute_unknown_source", event("mute_changed", { muted: true, source: "app" }));
bad("audio_start_stream_zero", event("audio_start", { ...audioStart, stream_id: 0 }));
bad("audio_start_stream_65536", event("audio_start", { ...audioStart, stream_id: 65536 }));
bad("audio_start_unknown_codec", event("audio_start", { ...audioStart, codec: "opus" }));
bad("audio_start_rate_low", event("audio_start", { ...audioStart, sample_rate: 7999 }));
bad("audio_start_rate_high", event("audio_start", { ...audioStart, sample_rate: 48001 }));
bad("audio_start_channels_3", event("audio_start", { ...audioStart, channels: 3 }));
bad("audio_start_frame_ms_9", event("audio_start", { ...audioStart, frame_ms: 9 }));
bad("audio_start_frame_ms_61", event("audio_start", { ...audioStart, frame_ms: 61 }));
bad("audio_start_preroll_2001", event("audio_start", { ...audioStart, preroll_ms: 2001 }));
bad("audio_end_unknown_reason", event("audio_end", { stream_id: 1, reason: "timeout", frames: 1, duration_ms: 1 }));
bad("error_unknown_code", event("error", { code: "E_UNKNOWN", detail: "x" }));
bad("error_detail_empty", event("error", { code: "E_HW", detail: "" }));
bad("error_detail_129_chars", event("error", { code: "E_HW", detail: "x".repeat(129) }));
bad("expression_duration_60001", command("expression", { state: "idle", animation: "blink", duration_ms: 60001 }));
bad("expression_animation_path", command("expression", { state: "idle", animation: "../blink", duration_ms: 0 }));
bad("display_text_65_chars", command("display_text", { ...showText, text: "🌐".repeat(65) }));
bad("display_text_empty", command("display_text", { ...showText, text: "" }));
bad("display_text_newline", command("display_text", { ...showText, text: "a\nb" }));
bad("display_text_ttl_99", command("display_text", { ...showText, ttl_ms: 99 }));
bad("display_text_ttl_60001", command("display_text", { ...showText, ttl_ms: 60001 }));
bad("audio_play_rate_high", command("audio_play_start", { ...audioPlay, sample_rate: 96000 }));
bad("audio_play_stream_zero", command("audio_play_end", { ...audioPlay, stream_id: 0 }));
bad("cancel_stream_missing", command("cancel", {}));
bad("set_config_volume_101", command("set_config", { speaker_volume: 101 }));
bad("set_config_sensitivity_negative", command("set_config", { wake_sensitivity: -1 }));
bad("set_config_volume_fraction", command("set_config", { speaker_volume: 50.5 }));
bad("set_config_vad_199", command("set_config", { vad_silence_ms: 199 }));
bad("set_config_vad_5001", command("set_config", { vad_silence_ms: 5001 }));
bad("set_config_max_utterance_999", command("set_config", { max_utterance_ms: 999 }));
bad("set_config_max_utterance_60001", command("set_config", { max_utterance_ms: 60001 }));
bad("set_config_unknown_field", command("set_config", { brightness: 50 }));
bad("servo_pose_duration_60001", command("servo_pose", { pose: "nod", duration_ms: 60001 }));
bad("pair_begin_timeout_999", command("pair_begin", { timeout_ms: 999 }));
bad("pair_begin_timeout_30001", command("pair_begin", { timeout_ms: 30001 }));
bad("pair_set_key_62_digits", command("pair_set_key", { pair_key: KEY.slice(2) }));
bad("pair_set_key_66_digits", command("pair_set_key", { pair_key: KEY + "00" }));
bad("pair_set_key_uppercase", command("pair_set_key", { pair_key: KEY.toUpperCase() }));
bad("pair_set_key_not_hex", command("pair_set_key", { pair_key: "g" + KEY.slice(1) }));
bad("pair_set_key_trailing_newline", command("pair_set_key", { pair_key: KEY + "\n" }));
bad("pair_set_key_array", command("pair_set_key", { pair_key: Array.from(Buffer.from(KEY, "hex")) }));
bad("command_error_unknown_code", response("command_error", { code: "E_NOPE", detail: "x" }));
bad("command_ok_with_data", response("command_ok", { applied: true }));

function controlRows() {
  let sequence = 0;
  const line = (name, verdict, message) => {
    const payload = Buffer.from(JSON.stringify(message));
    return [name, verdict, sequence++, payload.toString("hex"), controlFrame(payload, sequence - 1).toString("hex")].join("\t");
  };
  return [
    "# name\tmessage\tsequence\tpayload_hex\twire_hex",
    ...valid.map(([name, message]) => line(name, "valid", message)),
    ...invalid.map(([name, message]) => line(name, "invalid", message)),
  ];
}

function cobsRows() {
  const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
  const cases = [
    ["empty", []],
    ["one_zero", [0]],
    ["two_zeros", [0, 0]],
    ["zero_between", [0x00, 0x11, 0x00]],
    ["zero_in_middle", [0x11, 0x22, 0x00, 0x33]],
    ["no_zero", [0x11, 0x22, 0x33, 0x44]],
    ["trailing_zeros", [0x11, 0x00, 0x00, 0x00]],
    ["run_253", range(1, 253)],
    ["run_254", range(1, 254)],
    ["run_254_then_zero_prefix", [0, ...range(1, 254)]],
    ["run_255", range(1, 255)],
    ["run_254_then_zero", [...range(2, 255), 0]],
    ["run_254_zero_one", [...range(3, 255), 0, 1]],
    ["run_508", [...range(1, 254), ...range(1, 254)]],
    ["run_509", [...range(1, 254), ...range(1, 254), 1]],
    ["all_ones_1040", Array(1040).fill(1)],
  ];
  return [
    "# name\traw_hex\tencoded_hex (no delimiter)",
    ...cases.map(([name, raw]) => [name, Buffer.from(raw).toString("hex"), cobsEncode(Buffer.from(raw)).toString("hex")].join("\t")),
  ];
}

function hmacRows() {
  const bytes = (value, count) => Buffer.alloc(count, value);
  const text = (value) => Buffer.from(value);
  const cases = [
    ["rfc4231_case_1", bytes(0x0b, 20), text("Hi There")],
    ["rfc4231_case_2", text("Jefe"), text("what do ya want for nothing?")],
    ["rfc4231_case_3", bytes(0xaa, 20), bytes(0xdd, 50)],
    ["rfc4231_case_4", Buffer.from(Array.from({ length: 25 }, (_, i) => i + 1)), bytes(0xcd, 50)],
    ["rfc4231_case_6_key_longer_than_block", bytes(0xaa, 131), text("Test Using Larger Than Block-Size Key - Hash Key First")],
    ["rfc4231_case_7_key_and_data_longer_than_block", bytes(0xaa, 131), text("This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.")],
  ];
  return [
    "# name\tkey_hex\tmessage_hex\thmac_sha256_hex",
    ...cases.map(([name, key, message]) => [name, key.toString("hex"), message.toString("hex"), createHmac("sha256", key).update(message).digest("hex")].join("\t")),
  ];
}

// The independent expectation: tests/fixtures/wire.json, also used by Rust and TypeScript.
const wire = JSON.parse(await readFile(new URL("wire.json", fixtures), "utf8"));
function transitionRows() {
  return [
    "# from\tallowed (one 0 or 1 per state, in the order of the rows)",
    ...wire.expressions.map((from, index) => [from, wire.transition_rows[index].map((allowed) => (allowed ? 1 : 0)).join("")].join("\t")),
  ];
}

function proofRows() {
  const cases = [
    ["session_proof_1", NONCE_PAIRED, DEVICE, SESSION],
    ["session_proof_2", NONCE, "dev_00000000-0000-4000-8000-000000000000", "session_with-long_id_0123456789"],
    // Device "ab" with session "c" must differ from device "a" with session "bc".
    ["separator_ab_c", NONCE, "ab", "c"],
    ["separator_a_bc", NONCE, "a", "bc"],
  ];
  return [
    "# name\tkey_hex\tnonce_hex\tdevice_id\tsession_id\tinput_hex\tproof_hex",
    ...cases.map(([name, nonce, device, session]) => {
      const { input, mac } = proof(nonce, device, session);
      return [name, KEY, nonce, device, session, input.toString("hex"), mac.toString("hex")].join("\t");
    }),
  ];
}

const outputs = {
  "control-vectors.tsv": controlRows(),
  "cobs-vectors.tsv": cobsRows(),
  "hmac-vectors.tsv": hmacRows(),
  "proof-vectors.tsv": proofRows(),
  "transition-vectors.tsv": transitionRows(),
};

let stale = false;
for (const [file, lines] of Object.entries(outputs)) {
  const expected = `${lines.join("\n")}\n`;
  const url = new URL(file, fixtures);
  if (check) {
    const actual = await readFile(url, "utf8").catch(() => null);
    if (actual !== expected) {
      console.error(`out of date: tests/fixtures/${file}`);
      stale = true;
    }
  } else {
    await writeFile(url, expected);
    console.log(`wrote tests/fixtures/${file} (${lines.length - 1} rows)`);
  }
}
if (stale) process.exit(1);

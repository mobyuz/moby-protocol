import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { crc32 } from "node:zlib";
import Ajv2020 from "ajv/dist/2020.js";
import { PACKAGE_VERSION, USB } from "@mobyuz/moby-protocol";

const fixture = await readFile(new URL("./fixtures/usb-vectors.tsv", import.meta.url), "utf8");
const rows = fixture.trimEnd().split(/\r?\n/).slice(1).map((line) => line.split("\t"));

function decodeFrame(wire) {
  if (wire.length > USB.MAX_WIRE_LEN || wire.at(-1) !== USB.DELIMITER) {
    return "bad_frame";
  }
  const encoded = wire.subarray(0, -1);
  if (encoded.includes(USB.DELIMITER)) return "bad_frame";

  const raw = Buffer.alloc(USB.MAX_DECODED_LEN);
  let length = 0;
  for (let offset = 0; offset < encoded.length;) {
    const code = encoded[offset++];
    const end = offset + code - 1;
    const addZero = code !== 0xff && end < encoded.length;
    if (end > encoded.length || length + code - 1 + Number(addZero) > raw.length) {
      return "bad_frame";
    }
    length += encoded.copy(raw, length, offset, end);
    if (addZero) raw[length++] = USB.DELIMITER;
    offset = end;
  }

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
      if (actual.kind === USB.CONTROL) {
        const control = JSON.parse(actual.payload.toString("utf8"));
        assert.equal(validate(control), true, name);
      }
    } else {
      assert.equal(actual, expected, name);
    }
  }
});

test("USB control schema checks versions, direction, and strict payloads", () => {
  const hello = JSON.parse(Buffer.from(rows.find(([name]) => name === "hello")[5], "hex"));
  const heartbeat = JSON.parse(Buffer.from(rows.find(([name]) => name === "heartbeat")[5], "hex"));
  for (const invalid of [
    { ...hello, v: 2 },
    { ...hello, kind: "command" },
    { ...hello, name: "reset" },
    { ...hello, data: { ...hello.data, pair_key: "unexpected" } },
    { ...heartbeat, data: { ...heartbeat.data, uptime_ms: -1 } },
    { ...heartbeat, data: { ...heartbeat.data, uptime_ms: 2 ** 32 } },
  ]) {
    assert.equal(validate(invalid), false, JSON.stringify(invalid));
  }
});

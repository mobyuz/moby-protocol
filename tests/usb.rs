mod common;

use common::{feed, hex, rows};
use moby_protocol::{
    StableId,
    usb::{
        ControlMessage, Frame, FrameDecoder, FrameError, FrameKind, MAX_DECODED_LEN,
        MAX_ENCODED_LEN, MAX_PAYLOAD_LEN, MAX_WIRE_LEN, Nonce, PairKey,
    },
};
use serde_json::{Value, json};

fn control(name: &str) -> Value {
    let row = rows(include_str!("fixtures/control-vectors.tsv"))
        .into_iter()
        .find(|row| row[0] == name)
        .expect("control vector exists");
    serde_json::from_slice(&hex(row[3])).unwrap()
}

#[test]
fn shared_vectors_decode_and_valid_frames_encode_byte_for_byte() {
    let mut decoder = FrameDecoder::default();
    for fields in rows(include_str!("fixtures/usb-vectors.tsv")) {
        let [name, result, kind, stream, sequence, payload, wire] = fields[..] else {
            panic!("invalid fixture: {fields:?}");
        };
        let wire = hex(wire);
        let result = match result {
            "ok" => {
                let frame =
                    feed(&mut decoder, &wire).unwrap_or_else(|error| panic!("{name}: {error}"));
                assert_eq!(frame.kind as u8, kind.parse::<u8>().unwrap(), "{name}");
                assert_eq!(frame.stream_id, stream.parse::<u16>().unwrap(), "{name}");
                assert_eq!(frame.sequence, sequence.parse::<u32>().unwrap(), "{name}");
                assert_eq!(frame.payload, hex(payload), "{name}");
                let mut output = [0; MAX_WIRE_LEN];
                let written = frame.encode(&mut output).unwrap();
                assert_eq!(output[..written], wire, "{name}");
                continue;
            }
            "bad_frame" => FrameError::BadFrame,
            "bad_crc" => FrameError::BadCrc,
            "unsupported_version" => FrameError::UnsupportedVersion(2),
            _ => panic!("unknown outcome: {result}"),
        };
        assert_eq!(feed(&mut decoder, &wire), Err(result), "{name}");
    }
}

#[test]
fn decoder_bounds_segments_and_recovers_after_corruption_or_disconnect() {
    let frame = Frame {
        kind: FrameKind::RobotAudio,
        stream_id: 1,
        sequence: 0,
        payload: &[0xa7; MAX_PAYLOAD_LEN],
    };
    let mut output = [0; MAX_WIRE_LEN];
    let written = frame.encode(&mut output).unwrap();
    let wire = &output[..written];
    let mut decoder = FrameDecoder::default();
    assert!(decoder.push(0).is_none());
    for _ in 0..(MAX_ENCODED_LEN + 1000) {
        assert!(decoder.push(0xff).is_none());
    }
    assert_eq!(decoder.push(0), Some(Err(FrameError::FrameTooLarge)));
    assert_eq!(feed(&mut decoder, wire), Ok(frame));

    assert!(decoder.push(0xff).is_none());
    assert_eq!(decoder.push(0), Some(Err(FrameError::BadFrame)));
    assert_eq!(feed(&mut decoder, wire), Ok(frame));

    for &byte in &wire[..10] {
        assert!(decoder.push(byte).is_none());
    }
    decoder.reset();
    assert_eq!(feed(&mut decoder, wire), Ok(frame));
    assert_eq!(frame.encode(&mut []), Err(FrameError::OutputTooSmall));
    assert_eq!(frame.encode(&mut [0]), Err(FrameError::OutputTooSmall));
    assert_eq!(frame.encode(&mut [0; 3]), Err(FrameError::OutputTooSmall));
    assert_eq!(
        Frame {
            payload: &[0; MAX_PAYLOAD_LEN + 1],
            ..frame
        }
        .encode(&mut output),
        Err(FrameError::FrameTooLarge),
    );
    assert_eq!(
        Frame {
            stream_id: 0,
            ..frame
        }
        .encode(&mut output),
        Err(FrameError::BadFrame),
    );
}

#[test]
fn all_payload_lengths_round_trip_with_and_without_zero_bytes() {
    let mut decoder = FrameDecoder::default();
    let mut wire = [0; MAX_WIRE_LEN];
    let nonzero = [0xa5; MAX_PAYLOAD_LEN];
    let mut mixed = nonzero;
    for index in (0..MAX_PAYLOAD_LEN).step_by(7) {
        mixed[index] = 0;
    }
    for bytes in [&nonzero, &mixed] {
        for length in 0..=MAX_PAYLOAD_LEN {
            let frame = Frame {
                kind: FrameKind::DesktopAudio,
                stream_id: 2,
                sequence: length as u32,
                payload: &bytes[..length],
            };
            let written = frame.encode(&mut wire).unwrap();
            assert_eq!(feed(&mut decoder, &wire[..written]), Ok(frame));
        }
    }
}

#[test]
fn handshake_requires_a_matching_id_compatible_protocol_and_local_admission() {
    let hello_id = StableId::new("e-0001").unwrap();
    let session_id = StableId::new("session_1").unwrap();
    let hello: ControlMessage = serde_json::from_value(control("hello")).unwrap();
    let ack = hello
        .acknowledge_hello(Some(session_id.clone()), None, 11)
        .unwrap();
    assert_eq!(serde_json::to_value(&ack).unwrap(), control("hello_ack"));
    assert_eq!(ack.accepted_session(&hello_id), Some(&session_id));
    let mut incomplete = control("hello_ack");
    incomplete["data"]["session_id"] = Value::Null;
    let incomplete: ControlMessage = serde_json::from_value(incomplete).unwrap();
    assert!(incomplete.accepted_session(&hello_id).is_none());
    assert!(
        ack.accepted_session(&StableId::new("e-other").unwrap())
            .is_none()
    );
    assert!(
        hello
            .acknowledge_hello(None, None, 11)
            .unwrap()
            .accepted_session(&hello_id)
            .is_none()
    );

    let mut mismatched = control("hello");
    mismatched["data"]["protocol_version"] = json!(2);
    let mismatched: ControlMessage = serde_json::from_value(mismatched).unwrap();
    let rejection = mismatched
        .acknowledge_hello(Some(session_id), None, 11)
        .unwrap();
    assert_eq!(
        serde_json::to_value(&rejection).unwrap()["data"],
        json!({"accepted": false, "config": {}})
    );
    assert!(rejection.accepted_session(&hello_id).is_none());
    assert!(ack.acknowledge_hello(None, None, 11).is_none());
}

fn desktop_nonce() -> Nonce {
    Nonce::try_from("0f1e2d3c4b5a69788796a5b4c3d2e1f0".to_owned()).unwrap()
}

#[test]
fn hello_ack_carries_a_proof_only_for_a_paired_robot_with_a_session_and_key() {
    let key = PairKey::from_bytes(core::array::from_fn(|index| index as u8));
    let session_id = StableId::new("session_1").unwrap();
    let paired: ControlMessage = serde_json::from_value(control("hello_paired")).unwrap();
    let ack = paired
        .acknowledge_hello(Some(session_id.clone()), Some((&key, desktop_nonce())), 11)
        .unwrap();
    let ControlMessage::HelloAck { data, .. } = &ack else {
        panic!("expected hello_ack");
    };
    assert_eq!(
        serde_json::to_value(&ack).unwrap(),
        control("hello_ack_proof")
    );
    assert!(data.proof.is_some());
    assert_eq!(data.desktop_nonce, Some(desktop_nonce()));

    let proof_of = |message: Option<ControlMessage>| match message.unwrap() {
        ControlMessage::HelloAck { data, .. } => {
            assert_eq!(data.proof.is_some(), data.desktop_nonce.is_some());
            data.proof
        }
        _ => panic!("expected hello_ack"),
    };
    assert!(proof_of(paired.acknowledge_hello(Some(session_id.clone()), None, 11)).is_none());
    assert!(proof_of(paired.acknowledge_hello(None, Some((&key, desktop_nonce())), 11)).is_none());
    let unpaired: ControlMessage = serde_json::from_value(control("hello")).unwrap();
    assert!(
        proof_of(unpaired.acknowledge_hello(Some(session_id), Some((&key, desktop_nonce())), 11))
            .is_none()
    );
    let ControlMessage::Hello { data, .. } = &paired else {
        panic!("expected hello");
    };
    assert_eq!(
        data.nonce,
        Nonce::try_from("00112233445566778899aabbccddeeff".to_owned()).unwrap()
    );
}

#[test]
fn malformed_control_messages_are_rejected() {
    let hello = control("hello");
    let unknown = json!({"v": 1, "kind": "command", "name": "reset"});
    assert!(serde_json::from_value::<ControlMessage>(unknown).is_err());

    let mut wrong_version = hello.clone();
    wrong_version["v"] = json!(2);
    assert!(serde_json::from_value::<ControlMessage>(wrong_version).is_err());

    let mut wrong_kind = hello.clone();
    wrong_kind["kind"] = json!("command");
    assert!(serde_json::from_value::<ControlMessage>(wrong_kind).is_err());

    let mut extra = hello;
    extra["data"]["pair_key"] = json!("unexpected");
    assert!(serde_json::from_value::<ControlMessage>(extra).is_err());

    let mut negative = control("heartbeat");
    negative["data"]["uptime_ms"] = json!(-1);
    assert!(serde_json::from_value::<ControlMessage>(negative).is_err());
}

#[test]
fn cobs_vectors_encode_and_decode_identically_to_the_shared_files() {
    let vectors = rows(include_str!("fixtures/cobs-vectors.tsv"));
    assert!(vectors.len() >= 16);
    for fields in vectors {
        let [name, raw, encoded] = fields[..] else {
            panic!("invalid fixture: {fields:?}");
        };
        let (raw, encoded) = (hex(raw), hex(encoded));
        let mut output = [0; MAX_ENCODED_LEN];
        let written = cobs::try_encode(&raw, &mut output).unwrap();
        assert_eq!(output[..written], encoded, "{name}");
        let mut decoded = [0; MAX_DECODED_LEN];
        let report = cobs::decode(&encoded, &mut decoded).unwrap();
        assert_eq!(report.parsed_size(), encoded.len(), "{name}");
        assert_eq!(decoded[..report.frame_size()], raw, "{name}");
    }
}

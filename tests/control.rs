mod common;

use common::{feed, hex, rows};
use moby_protocol::usb::{
    AudioStart, ControlMessage, DeviceConfig, ErrorCode, ErrorDetail, Frame, FrameDecoder,
    FrameKind, MAX_PAYLOAD_LEN, MAX_WIRE_LEN, MESSAGES, Peer,
};
use serde_json::{Value, json};

struct Vector {
    name: &'static str,
    valid: bool,
    sequence: u32,
    payload: Vec<u8>,
    wire: Vec<u8>,
}

fn vectors() -> Vec<Vector> {
    rows(include_str!("fixtures/control-vectors.tsv"))
        .into_iter()
        .map(|fields| {
            let [name, verdict, sequence, payload, wire] = fields[..] else {
                panic!("invalid fixture: {fields:?}");
            };
            let valid = match verdict {
                "valid" => true,
                "invalid" => false,
                _ => panic!("unknown verdict: {verdict}"),
            };
            Vector {
                name,
                valid,
                sequence: sequence.parse().unwrap(),
                payload: hex(payload),
                wire: hex(wire),
            }
        })
        .collect()
}

fn valid_messages() -> Vec<(&'static str, Value)> {
    vectors()
        .into_iter()
        .filter(|vector| vector.valid)
        .map(|vector| {
            (
                vector.name,
                serde_json::from_slice(&vector.payload).unwrap(),
            )
        })
        .collect()
}

fn message(name: &str) -> Value {
    valid_messages()
        .into_iter()
        .find(|(candidate, _)| *candidate == name)
        .expect("vector exists")
        .1
}

fn parses(value: &Value) -> bool {
    serde_json::from_value::<ControlMessage>(value.clone()).is_ok()
}

#[test]
fn an_empty_set_config_is_the_keepalive_frame() {
    let keepalive = json!({
        "v": 1, "kind": "command", "name": "set_config", "id": "c-0001", "ts_ms": 10, "data": {}
    });
    assert!(matches!(
        serde_json::from_value::<ControlMessage>(keepalive.clone()),
        Ok(ControlMessage::SetConfig { data, .. }) if data == DeviceConfig::default()
    ));
    // A keepalive that omits `data` is not a valid frame.
    let mut missing = keepalive;
    missing.as_object_mut().unwrap().remove("data");
    assert!(!parses(&missing));
}

#[test]
fn control_vectors_are_framed_and_judged_as_labeled() {
    let mut decoder = FrameDecoder::default();
    for vector in vectors() {
        let frame =
            feed(&mut decoder, &vector.wire).unwrap_or_else(|e| panic!("{}: {e}", vector.name));
        assert_eq!(frame.kind, FrameKind::Control, "{}", vector.name);
        assert_eq!(frame.stream_id, 0, "{}", vector.name);
        assert_eq!(frame.sequence, vector.sequence, "{}", vector.name);
        assert_eq!(frame.payload, vector.payload, "{}", vector.name);
        let mut output = [0; MAX_WIRE_LEN];
        let written = frame.encode(&mut output).unwrap();
        assert_eq!(output[..written], vector.wire, "{}", vector.name);

        let json: Value = serde_json::from_slice(frame.payload).unwrap();
        let decoded = serde_json::from_slice::<ControlMessage>(frame.payload);
        assert_eq!(
            decoded.is_ok(),
            vector.valid,
            "{}: {decoded:?}",
            vector.name
        );
        if let Ok(decoded) = decoded {
            assert_eq!(
                serde_json::to_value(&decoded).unwrap(),
                json,
                "{}",
                vector.name
            );
            assert_eq!(decoded.name(), json["name"], "{}", vector.name);
        }
    }
}

#[test]
fn every_message_name_has_a_positive_vector_and_the_catalog_matches_the_wire() {
    let valid = valid_messages();
    assert_eq!(MESSAGES.len(), 23);
    for info in MESSAGES {
        let samples: Vec<_> = valid
            .iter()
            .filter(|(_, json)| json["name"] == info.name)
            .collect();
        assert!(!samples.is_empty(), "no positive vector for {}", info.name);
        for (name, json) in samples {
            assert_eq!(json["kind"], info.kind, "{name}");
            let decoded: ControlMessage = serde_json::from_value(json.clone()).unwrap();
            assert_eq!(decoded.sender(), info.sender, "{name}");
        }
    }
    for (name, json) in &valid {
        assert_eq!(
            MESSAGES
                .iter()
                .filter(|info| json["name"] == info.name)
                .count(),
            1,
            "{name}"
        );
    }
    let mut names: Vec<_> = MESSAGES.iter().map(|info| info.name).collect();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), MESSAGES.len());
}

#[test]
fn events_come_from_the_robot_and_commands_from_the_desktop() {
    for info in MESSAGES {
        let expected = match (info.kind, info.name) {
            ("event", _) | ("response", "command_ok" | "command_error") => Peer::Robot,
            ("command", _) | ("response", "hello_ack") => Peer::Desktop,
            other => panic!("unexpected {other:?}"),
        };
        assert_eq!(info.sender, expected, "{}", info.name);
    }
    let events: Vec<_> = MESSAGES
        .iter()
        .filter(|info| info.kind == "event")
        .collect();
    assert_eq!(events.len(), 11);
    assert_eq!(
        MESSAGES
            .iter()
            .filter(|info| info.kind == "command")
            .count(),
        9
    );
    assert_eq!(
        MESSAGES
            .iter()
            .filter(|info| info.kind == "response")
            .count(),
        3
    );
}

#[test]
fn every_valid_message_rejects_extra_fields_other_kinds_and_missing_fields() {
    // Fields the robot or desktop may leave out. `proof` and `desktop_nonce`
    // are not here: removing one of the pair is invalid, and the session_proof
    // event needs its proof.
    let optional = [
        "session_id",
        "wake_sensitivity",
        "speaker_volume",
        "vad_silence_ms",
        "max_utterance_ms",
    ];
    for (name, json) in valid_messages() {
        for field in ["extra", "pair_key", "path"] {
            let mut envelope = json.clone();
            envelope[field] = json!("unexpected");
            assert!(!parses(&envelope), "{name}: envelope field {field}");
            let mut data = json.clone();
            data["data"][field] = json!("unexpected");
            assert!(!parses(&data), "{name}: data field {field}");
        }
        for kind in ["event", "command", "response"] {
            let mut other = json.clone();
            other["kind"] = json!(kind);
            assert_eq!(parses(&other), kind == json["kind"], "{name} as {kind}");
        }
        for key in json.as_object().unwrap().keys() {
            let mut missing = json.clone();
            missing.as_object_mut().unwrap().remove(key);
            assert!(!parses(&missing), "{name}: missing {key}");
        }
        for key in json["data"].as_object().unwrap().keys() {
            let mut missing = json.clone();
            missing["data"].as_object_mut().unwrap().remove(key);
            assert_eq!(
                parses(&missing),
                optional.contains(&key.as_str()),
                "{name}: missing data.{key}"
            );
        }
        for version in [json!(0), json!(2), json!("1"), json!(null)] {
            let mut wrong = json.clone();
            wrong["v"] = version;
            assert!(!parses(&wrong), "{name}");
        }
        let mut renamed = json.clone();
        renamed["name"] = json!(format!("{}_x", json["name"].as_str().unwrap()));
        assert!(!parses(&renamed), "{name}");
    }
}

#[test]
fn unknown_names_and_wrong_types_for_a_name_are_rejected() {
    for name in ["reboot", "Heartbeat", "HELLO", "", "hello ", "hello_ack\n"] {
        let mut unknown = message("heartbeat");
        unknown["name"] = json!(name);
        assert!(!parses(&unknown), "{name:?}");
    }
    for value in [json!(null), json!(7), json!([]), json!({})] {
        let mut unknown = message("heartbeat");
        unknown["name"] = value;
        assert!(!parses(&unknown));
    }
    // A payload that belongs to another name does not fit.
    let mut swapped = message("cancel");
    swapped["data"] = message("pair_begin")["data"].clone();
    assert!(!parses(&swapped));
    let mut duplicate =
        String::from(r#"{"v":1,"kind":"event","name":"pair_reset","name":"pair_reset","#);
    duplicate.push_str(r#""id":"e-1","ts_ms":1,"data":{}}"#);
    assert!(serde_json::from_str::<ControlMessage>(&duplicate).is_err());
}

/// One bound: where it lives, what the edges accept, and what falls outside.
struct Bound {
    vector: &'static str,
    path: &'static str,
    accepted: Vec<Value>,
    rejected: Vec<Value>,
}

fn bound(
    vector: &'static str,
    path: &'static str,
    accepted: Vec<Value>,
    rejected: Vec<Value>,
) -> Bound {
    Bound {
        vector,
        path,
        accepted,
        rejected,
    }
}

fn range(vector: &'static str, path: &'static str, min: i64, max: i64) -> Bound {
    bound(
        vector,
        path,
        vec![json!(min), json!(max)],
        vec![
            json!(min - 1),
            json!(max + 1),
            json!(min as f64 + 0.5),
            json!(max.to_string()),
            json!(true),
        ],
    )
}

#[test]
fn numeric_bounds_accept_their_limits_and_reject_the_values_beyond() {
    let bounds = vec![
        range("audio_start", "/data/stream_id", 1, 65535),
        range("audio_start", "/data/sample_rate", 8000, 48000),
        range("audio_start", "/data/channels", 1, 2),
        range("audio_start", "/data/frame_ms", 10, 60),
        range("audio_start", "/data/preroll_ms", 0, 2000),
        range("audio_end", "/data/stream_id", 1, 65535),
        range("audio_play_start", "/data/stream_id", 1, 65535),
        range("audio_play_start", "/data/sample_rate", 8000, 48000),
        range("audio_play_end", "/data/sample_rate", 8000, 48000),
        range("cancel", "/data/stream_id", 1, 65535),
        range("expression", "/data/duration_ms", 0, 60000),
        range("servo_pose", "/data/duration_ms", 0, 60000),
        range("display_text", "/data/ttl_ms", 100, 60000),
        range("pair_begin", "/data/timeout_ms", 1000, 30000),
        range("set_config_maximums", "/data/wake_sensitivity", 0, 100),
        range("set_config_maximums", "/data/speaker_volume", 0, 100),
        range("set_config_maximums", "/data/vad_silence_ms", 200, 5000),
        range("set_config_maximums", "/data/max_utterance_ms", 1000, 60000),
        range("heartbeat", "/ts_ms", 0, i64::from(u32::MAX)),
        range("heartbeat", "/data/uptime_ms", 0, i64::from(u32::MAX)),
        range("audio_end", "/data/frames", 0, i64::from(u32::MAX)),
        range("audio_end", "/data/duration_ms", 0, i64::from(u32::MAX)),
        range("hello", "/data/protocol_version", 0, i64::from(u32::MAX)),
    ];
    for Bound {
        vector,
        path,
        accepted,
        rejected,
    } in bounds
    {
        for value in accepted {
            let mut json = message(vector);
            *json.pointer_mut(path).unwrap() = value.clone();
            assert!(parses(&json), "{vector} {path} = {value}");
        }
        for value in rejected {
            let mut json = message(vector);
            *json.pointer_mut(path).unwrap() = value.clone();
            assert!(!parses(&json), "{vector} {path} = {value}");
        }
        // Only the optional configuration fields accept null.
        let mut json = message(vector);
        *json.pointer_mut(path).unwrap() = json!(null);
        assert_eq!(
            parses(&json),
            vector.starts_with("set_config"),
            "{vector} {path} = null"
        );
    }
}

#[test]
fn text_bounds_count_code_points_and_reject_control_characters() {
    let text = |vector: &str, path: &str, value: Value| {
        let mut json = message(vector);
        *json.pointer_mut(path).unwrap() = value;
        parses(&json)
    };
    for (vector, path, max) in [
        ("display_text", "/data/text", 64),
        ("error", "/data/detail", 128),
        ("command_error", "/data/detail", 128),
        ("hello", "/data/fw_version", 32),
        ("hello", "/data/hw_rev", 32),
        ("wake_detected", "/data/model_version", 32),
    ] {
        let ascii = |count: usize| json!("x".repeat(count));
        assert!(text(vector, path, ascii(1)), "{vector} {path}");
        assert!(text(vector, path, ascii(max)), "{vector} {path}");
        assert!(!text(vector, path, ascii(0)), "{vector} {path}");
        assert!(!text(vector, path, ascii(max + 1)), "{vector} {path}");
        assert!(!text(vector, path, json!(7)), "{vector} {path}");
        assert!(!text(vector, path, json!(null)), "{vector} {path}");
    }
    // Four-byte characters count once, not four times.
    assert!(text("display_text", "/data/text", json!("🌐".repeat(64))));
    assert!(!text("display_text", "/data/text", json!("🌐".repeat(65))));
    assert!(text("error", "/data/detail", json!("ё".repeat(128))));
    for bad in ["a\nb", "a\tb", "\u{7f}", "\u{85}", "a\0b", "a\r"] {
        assert!(!text("display_text", "/data/text", json!(bad)), "{bad:?}");
        assert!(!text("error", "/data/detail", json!(bad)), "{bad:?}");
    }
    for bad in ["a b", "é", "a\n", "\u{7f}"] {
        assert!(!text("hello", "/data/fw_version", json!(bad)), "{bad:?}");
    }
    let mut capabilities = message("hello");
    capabilities["data"]["capabilities"] =
        json!((0..8).map(|i| format!("cap_{i}")).collect::<Vec<_>>());
    assert!(parses(&capabilities));
    capabilities["data"]["capabilities"] =
        json!((0..9).map(|i| format!("cap_{i}")).collect::<Vec<_>>());
    assert!(!parses(&capabilities));
    capabilities["data"]["capabilities"] = json!(["Bad"]);
    assert!(!parses(&capabilities));
}

#[test]
fn enums_and_names_accept_only_their_wire_spellings() {
    for (vector, path, accepted, rejected) in [
        (
            "button_event_press",
            "/data/action",
            vec!["press", "release", "long_press"],
            vec!["Press", "double", "longpress", ""],
        ),
        (
            "button_event_press",
            "/data/button",
            vec!["talk"],
            vec!["Talk", "mute", ""],
        ),
        (
            "mute_changed",
            "/data/source",
            vec!["switch", "boot"],
            vec!["app", "Switch"],
        ),
        (
            "audio_start",
            "/data/reason",
            vec!["wake", "button"],
            vec!["vad_silence", "Wake"],
        ),
        (
            "audio_start",
            "/data/codec",
            vec!["pcm_s16le"],
            vec!["opus", "PCM_S16LE", "pcm"],
        ),
        (
            "audio_end",
            "/data/reason",
            vec![
                "vad_silence",
                "max_duration",
                "button_release",
                "mute",
                "cancel",
                "error",
            ],
            vec!["wake", "timeout", "VadSilence"],
        ),
        (
            "heartbeat",
            "/data/state",
            vec![
                "idle",
                "listening",
                "thinking",
                "speaking",
                "happy",
                "confused",
                "error",
                "muted",
                "disconnected",
            ],
            vec!["asleep", "Idle"],
        ),
        (
            "expression",
            "/data/state",
            vec!["idle", "speaking"],
            vec!["online"],
        ),
        (
            "expression",
            "/data/animation",
            vec!["a", "blink_2", "spin-fast"],
            vec!["Blink", "../blink", "blink now", "", "1blink"],
        ),
        (
            "servo_pose",
            "/data/pose",
            vec!["nod"],
            vec!["Nod", "C:/nod", ""],
        ),
    ] {
        for value in accepted {
            let mut json = message(vector);
            *json.pointer_mut(path).unwrap() = json!(value);
            assert!(parses(&json), "{vector} {path} = {value}");
        }
        for value in rejected {
            let mut json = message(vector);
            *json.pointer_mut(path).unwrap() = json!(value);
            assert!(!parses(&json), "{vector} {path} = {value}");
        }
    }
}

#[test]
fn error_codes_use_the_plan_spellings_in_events_and_responses() {
    let spellings = [
        "E_PROTO_VERSION",
        "E_BAD_FRAME",
        "E_CRC",
        "E_STATE",
        "E_MUTED",
        "E_BUSY",
        "E_AUDIO_OVERRUN",
        "E_TIMEOUT",
        "E_UNSUPPORTED",
        "E_HW",
    ];
    assert_eq!(
        serde_json::to_value(ErrorCode::ALL).unwrap(),
        json!(spellings)
    );
    for vector in ["error", "command_error"] {
        for code in spellings {
            let mut json = message(vector);
            json["data"]["code"] = json!(code);
            assert!(parses(&json), "{vector} {code}");
        }
        for code in ["E_NONE", "e_state", "E_STATE ", "E_PROTO", "state", ""] {
            let mut json = message(vector);
            json["data"]["code"] = json!(code);
            assert!(!parses(&json), "{vector} {code:?}");
        }
    }
}

#[test]
fn every_command_gets_a_correlated_response_and_nothing_else_does() {
    let detail = ErrorDetail::new("not now").unwrap();
    for (name, json) in valid_messages() {
        let original: ControlMessage = serde_json::from_value(json.clone()).unwrap();
        let ok = original.respond_ok(77);
        let failure = original.respond_error(ErrorCode::Busy, detail.clone(), 78);
        if json["kind"] != "command" {
            assert!(ok.is_none() && failure.is_none(), "{name}");
            continue;
        }
        let (ok, failure) = (ok.unwrap(), failure.unwrap());
        assert_eq!(ok.id(), original.id(), "{name}");
        assert_eq!(failure.id(), original.id(), "{name}");
        assert_eq!(ok.sender(), Peer::Robot);
        let ok_json = serde_json::to_value(&ok).unwrap();
        assert_eq!(ok_json["name"], "command_ok");
        assert_eq!(ok_json["kind"], "response");
        assert_eq!(ok_json["data"], json!({}));
        let failure_json = serde_json::to_value(&failure).unwrap();
        assert_eq!(failure_json["name"], "command_error");
        assert_eq!(
            failure_json["data"],
            json!({"code": "E_BUSY", "detail": "not now"})
        );
        assert!(parses(&ok_json) && parses(&failure_json));
    }
    assert!(ErrorDetail::new("").is_err());
}

#[test]
fn audio_start_parameters_report_the_pcm_frame_size() {
    let start: ControlMessage = serde_json::from_value(message("audio_start")).unwrap();
    let ControlMessage::AudioStart { data, .. } = start else {
        panic!("expected audio_start");
    };
    // 16 kHz mono 16-bit PCM for 20 ms is the plan's 640-byte chunk.
    assert_eq!(data.frame_bytes(), 640);
    assert!(data.frame_bytes() <= MAX_PAYLOAD_LEN);
    let stereo: AudioStart = serde_json::from_value(json!({
        "stream_id": 1, "reason": "button", "codec": "pcm_s16le", "sample_rate": 48000,
        "channels": 2, "frame_ms": 60, "preroll_ms": 0
    }))
    .unwrap();
    assert!(stereo.frame_bytes() > MAX_PAYLOAD_LEN);
}

#[test]
fn control_frames_fit_the_payload_limit_at_the_largest_valid_messages() {
    // The longest valid IDs, versions, and capability list still fit.
    let mut hello = message("hello");
    hello["id"] = json!("i".repeat(64));
    hello["ts_ms"] = json!(u32::MAX);
    hello["data"]["device_id"] = json!("d".repeat(64));
    hello["data"]["protocol_version"] = json!(u32::MAX);
    hello["data"]["capabilities"] = json!(vec!["c".repeat(64); 8]);
    hello["data"]["fw_version"] = json!("v".repeat(32));
    hello["data"]["hw_rev"] = json!("h".repeat(32));
    let payload = serde_json::to_vec(&hello).unwrap();
    assert!(payload.len() <= MAX_PAYLOAD_LEN, "{}", payload.len());
    let mut detail = message("error");
    detail["data"]["detail"] = json!("🌐".repeat(128));
    assert!(serde_json::to_vec(&detail).unwrap().len() <= MAX_PAYLOAD_LEN);
    let mut output = [0; MAX_WIRE_LEN];
    let frame = Frame {
        kind: FrameKind::Control,
        stream_id: 0,
        sequence: 0,
        payload: &payload,
    };
    assert!(frame.encode(&mut output).is_ok());
}

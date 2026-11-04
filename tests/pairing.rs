mod common;

use common::{hex, rows};
use hmac::{Hmac, KeyInit, Mac};
use moby_protocol::{
    StableId,
    usb::{ControlMessage, Nonce, PairKey, Proof, session_proof_input},
};
use serde_json::{Value, json};
use sha2::Sha256;

const KEY_HEX: &str = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

fn test_key() -> PairKey {
    PairKey::try_from(KEY_HEX.to_owned()).unwrap()
}

fn message(name: &str) -> Value {
    let row = rows(include_str!("fixtures/control-vectors.tsv"))
        .into_iter()
        .find(|row| row[0] == name)
        .expect("control vector exists");
    serde_json::from_slice(&hex(row[3])).unwrap()
}

#[test]
fn hmac_matches_the_rfc_4231_vectors() {
    let vectors = rows(include_str!("fixtures/hmac-vectors.tsv"));
    assert_eq!(vectors.len(), 6);
    for fields in vectors {
        let [name, key, data, expected] = fields[..] else {
            panic!("invalid fixture: {fields:?}");
        };
        let mut mac = Hmac::<Sha256>::new_from_slice(&hex(key)).unwrap();
        mac.update(&hex(data));
        assert_eq!(
            mac.finalize().into_bytes().as_slice(),
            hex(expected),
            "{name}"
        );
    }
}

#[test]
fn session_proofs_match_the_shared_vectors() {
    let vectors = rows(include_str!("fixtures/proof-vectors.tsv"));
    assert!(vectors.len() >= 4);
    for fields in vectors {
        let [name, key, nonce, device, session, input, proof] = fields[..] else {
            panic!("invalid fixture: {fields:?}");
        };
        let key = PairKey::try_from(key.to_owned()).unwrap();
        let nonce = Nonce::try_from(nonce.to_owned()).unwrap();
        let device = StableId::new(device).unwrap();
        let session = StableId::new(session).unwrap();
        assert_eq!(
            session_proof_input(&nonce, &device, &session),
            hex(input),
            "{name}"
        );
        let computed = key.session_proof(&nonce, &device, &session);
        assert_eq!(computed.as_str(), proof, "{name}");
        assert!(
            key.verify_session_proof(&nonce, &device, &session, &computed),
            "{name}"
        );
    }
}

#[test]
fn the_proof_input_separates_the_device_and_session_ids() {
    let rows = rows(include_str!("fixtures/proof-vectors.tsv"));
    let proof_of = |name: &str| rows.iter().find(|row| row[0] == name).unwrap()[6];
    // Without the zero byte, device "ab" + session "c" would equal "a" + "bc".
    assert_ne!(proof_of("separator_ab_c"), proof_of("separator_a_bc"));
}

#[test]
fn a_proof_binds_the_key_nonce_device_and_session() {
    let key = test_key();
    let nonce = Nonce::from_bytes([7; 16]);
    let device = StableId::new("dev_one").unwrap();
    let session = StableId::new("session_1").unwrap();
    let proof = key.session_proof(&nonce, &device, &session);
    assert!(key.verify_session_proof(&nonce, &device, &session, &proof));

    let other_key = PairKey::from_bytes([9; 32]);
    assert!(!other_key.verify_session_proof(&nonce, &device, &session, &proof));
    assert!(!key.verify_session_proof(&Nonce::from_bytes([8; 16]), &device, &session, &proof));
    assert!(!key.verify_session_proof(
        &nonce,
        &StableId::new("dev_two").unwrap(),
        &session,
        &proof
    ));
    assert!(!key.verify_session_proof(
        &nonce,
        &device,
        &StableId::new("session_2").unwrap(),
        &proof
    ));
    let mut flipped = proof.to_bytes();
    flipped[31] ^= 1;
    assert!(!key.verify_session_proof(&nonce, &device, &session, &Proof::from_bytes(flipped)));
    assert!(!key.verify_session_proof(&nonce, &device, &session, &Proof::from_bytes([0; 32])));
}

#[test]
fn the_pair_key_never_appears_in_debug_output() {
    let key = test_key();
    for text in [format!("{key:?}"), format!("{key:#?}")] {
        assert_eq!(text.trim(), "PairKey(<redacted>)");
        assert!(!text.contains(KEY_HEX) && !text.contains("0102030405"));
    }
    // The key is also hidden when it is inside a message, an option, or a Vec.
    let command: ControlMessage = serde_json::from_value(message("pair_set_key")).unwrap();
    for text in [
        format!("{command:?}"),
        format!("{command:#?}"),
        format!("{:?}", Some(&command)),
        format!("{:?}", vec![command.clone()]),
    ] {
        assert!(text.contains("<redacted>"), "{text}");
        assert!(
            !text.contains(KEY_HEX) && !text.contains("0102030405"),
            "{text}"
        );
    }
    // Serialization still carries the key: pair_set_key must send it.
    assert_eq!(
        serde_json::to_value(&command).unwrap(),
        message("pair_set_key")
    );
    assert_eq!(serde_json::to_value(&key).unwrap(), json!(KEY_HEX));
    // A rejected key is not echoed in the error.
    let error = PairKey::try_from(format!("{KEY_HEX}00")).unwrap_err();
    assert!(!error.contains(KEY_HEX));
    let error = serde_json::from_value::<PairKey>(json!(format!("{KEY_HEX}00"))).unwrap_err();
    assert!(!error.to_string().contains(KEY_HEX));
}

#[test]
fn pair_keys_compare_by_value_and_clone() {
    let key = test_key();
    assert_eq!(key, key.clone());
    assert_ne!(key, PairKey::from_bytes([0; 32]));
    let mut bytes = key.to_bytes();
    bytes[31] ^= 0x80;
    assert_ne!(key, PairKey::from_bytes(bytes));
    assert_eq!(key.to_bytes()[..4], [0, 1, 2, 3]);
}

#[test]
fn hex_values_must_have_the_exact_length_and_lowercase_digits() {
    let valid_key = KEY_HEX.to_owned();
    assert!(PairKey::try_from(valid_key.clone()).is_ok());
    for invalid in [
        String::new(),
        valid_key[2..].to_owned(),
        valid_key[..63].to_owned(),
        format!("{valid_key}0"),
        format!("{valid_key}00"),
        valid_key.to_uppercase(),
        valid_key.replace("00", "0G"),
        format!("{valid_key}\n"),
        format!(" {}", &valid_key[1..]),
        format!("{}é", &valid_key[2..]),
        "é".repeat(32),
        format!("0x{}", &valid_key[2..]),
    ] {
        assert!(PairKey::try_from(invalid.clone()).is_err(), "{invalid:?}");
        assert!(serde_json::from_value::<PairKey>(json!(invalid)).is_err());
    }
    for invalid in [json!(null), json!(7), json!([0, 1]), json!({})] {
        assert!(serde_json::from_value::<PairKey>(invalid).is_err());
    }
    assert!(Nonce::try_from("a".repeat(32)).is_ok());
    assert!(Nonce::try_from("a".repeat(31)).is_err());
    assert!(Nonce::try_from("a".repeat(33)).is_err());
    assert!(Nonce::try_from("A".repeat(32)).is_err());
    assert!(Proof::try_from("a".repeat(64)).is_ok());
    assert!(Proof::try_from("a".repeat(32)).is_err());
    assert_eq!(Nonce::from_bytes([0xab; 16]).as_str(), "ab".repeat(16));
    assert_eq!(Proof::from_bytes([0xcd; 32]).to_bytes(), [0xcd; 32]);
}

#[test]
fn pairing_messages_follow_the_documented_sequence() {
    let begin: ControlMessage = serde_json::from_value(message("pair_begin")).unwrap();
    let confirmed: ControlMessage =
        serde_json::from_value(message("pair_button_confirmed")).unwrap();
    let set_key: ControlMessage = serde_json::from_value(message("pair_set_key")).unwrap();
    let reset: ControlMessage = serde_json::from_value(message("pair_reset")).unwrap();
    // The desktop opens the window and sends the key; the robot confirms and resets.
    assert_eq!(begin.sender(), moby_protocol::usb::Peer::Desktop);
    assert_eq!(set_key.sender(), moby_protocol::usb::Peer::Desktop);
    assert_eq!(confirmed.sender(), moby_protocol::usb::Peer::Robot);
    assert_eq!(reset.sender(), moby_protocol::usb::Peer::Robot);
    assert!(begin.respond_ok(1).is_some() && set_key.respond_ok(1).is_some());
    assert!(confirmed.respond_ok(1).is_none() && reset.respond_ok(1).is_none());

    // After pairing, the next hello reports paired and the ack proves the session.
    let ControlMessage::PairSetKey { data, .. } = &set_key else {
        panic!("expected pair_set_key");
    };
    let hello: ControlMessage = serde_json::from_value(message("hello_paired")).unwrap();
    let ack = hello
        .acknowledge_hello(
            Some(StableId::new("session_1").unwrap()),
            Some(&data.pair_key),
            11,
        )
        .unwrap();
    let (
        ControlMessage::Hello {
            data: hello_data, ..
        },
        ControlMessage::HelloAck { data: ack_data, .. },
    ) = (&hello, &ack)
    else {
        panic!("expected hello and hello_ack");
    };
    let session = ack_data.session_id.as_ref().unwrap();
    let proof = ack_data.proof.as_ref().unwrap();
    assert!(data.pair_key.verify_session_proof(
        &hello_data.nonce,
        &hello_data.device_id,
        session,
        proof
    ));
    // A different key, such as a desktop that was never paired, fails verification.
    assert!(!PairKey::from_bytes([1; 32]).verify_session_proof(
        &hello_data.nonce,
        &hello_data.device_id,
        session,
        proof
    ));
}

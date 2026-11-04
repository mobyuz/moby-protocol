use moby_protocol::{
    AgentTurnRequest, AgentTurnResponse, ApiError, ChatRequest, ChatResponse, ConsentType,
    Expression, Language, PACKAGE_VERSION, PROTOCOL_VERSION, Script, StableId, ToolRequest,
    ToolResult, UsageInfo, can_transition,
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

fn fixtures() -> Value {
    serde_json::from_str(include_str!("fixtures/wire.json")).unwrap()
}

fn round_trip<T: Serialize + DeserializeOwned>(value: &Value) {
    let decoded: T = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(decoded).unwrap(), *value);
}

#[test]
fn transition_table_covers_all_81_pairs() {
    let fixture = fixtures();
    let rows = fixture["transition_rows"].as_array().unwrap();
    assert_eq!(rows.len(), Expression::ALL.len());
    for (from_index, from) in Expression::ALL.into_iter().enumerate() {
        assert_eq!(rows[from_index].as_array().unwrap().len(), 9);
        for (to_index, to) in Expression::ALL.into_iter().enumerate() {
            assert_eq!(
                can_transition(from, to),
                rows[from_index][to_index].as_bool().unwrap(),
                "{from:?} -> {to:?}"
            );
        }
    }
}

#[test]
fn text_chat_and_failure_recovery_flows() {
    use Expression::*;
    for flow in [
        &[Idle, Thinking, Speaking, Happy, Idle][..],
        &[Idle, Listening, Thinking, Speaking, Idle][..],
        &[Thinking, Error, Thinking, Happy, Idle][..],
        &[Speaking, Disconnected, Idle, Thinking][..],
        &[Speaking, Muted, Idle, Listening][..],
    ] {
        for pair in flow.windows(2) {
            assert!(can_transition(pair[0], pair[1]));
        }
    }
    for state in Expression::ALL {
        assert!(can_transition(state, state));
        assert!(can_transition(state, Error));
        assert!(can_transition(state, Muted));
        assert!(can_transition(state, Disconnected));
    }
    assert!(!can_transition(Muted, Speaking));
    assert!(!can_transition(Disconnected, Thinking));
    assert!(!can_transition(Idle, Speaking));
}

#[test]
fn every_expression_has_a_stable_wire_name_and_round_trips() {
    let fixture = fixtures();
    assert_eq!(
        serde_json::to_value(Expression::ALL).unwrap(),
        fixture["expressions"]
    );
    for value in fixture["expressions"].as_array().unwrap() {
        round_trip::<Expression>(value);
    }
    for value in [json!("unknown"), json!("Idle"), json!(null), json!({})] {
        assert!(serde_json::from_value::<Expression>(value).is_err());
    }
}

#[test]
fn messages_round_trip_against_shared_wire_fixtures() {
    let fixture = fixtures();
    round_trip::<ChatRequest>(&fixture["chat_request"]);
    round_trip::<ChatResponse>(&fixture["chat_response"]);
    round_trip::<ChatResponse>(&fixture["chat_response_without_tool"]);
    round_trip::<ApiError>(&fixture["api_error"]);
    let response: ChatResponse =
        serde_json::from_value(fixture["chat_response_null_tool"].clone()).unwrap();
    assert_eq!(response.tool_request, None);
    assert_eq!(
        serde_json::to_value(response).unwrap(),
        fixture["chat_response_without_tool"]
    );
}

#[test]
fn all_tools_round_trip_and_reject_extra_fields_missing_ids_and_paths() {
    let fixture = fixtures();
    let mut invalid_ids = fixture["invalid_ids"].as_array().unwrap().clone();
    invalid_ids.extend([json!("a".repeat(65)), json!(null), json!(3), json!({})]);
    for value in fixture["tools"].as_array().unwrap() {
        round_trip::<ToolRequest>(value);
        for field in ["path", "command", "arguments", "unexpected"] {
            let mut extra = value.clone();
            extra[field] = json!("unexpected");
            assert!(serde_json::from_value::<ToolRequest>(extra).is_err());
        }
        for key in value
            .as_object()
            .unwrap()
            .keys()
            .filter(|key| *key != "tool")
        {
            let optional = value["tool"] == "open_project" && key == "app_id";
            if !optional {
                let mut missing = value.clone();
                missing.as_object_mut().unwrap().remove(key);
                assert!(serde_json::from_value::<ToolRequest>(missing).is_err());
            }
            if key.ends_with("_id") {
                for invalid_id in &invalid_ids {
                    if optional && invalid_id.is_null() {
                        continue;
                    }
                    let mut invalid = value.clone();
                    invalid[key] = invalid_id.clone();
                    assert!(serde_json::from_value::<ToolRequest>(invalid).is_err());
                }
            }
        }
    }
}

#[test]
fn tool_inputs_enforce_literal_queries_unicode_lengths_and_zoned_dates() {
    for value in fixtures()["invalid_tools"].as_array().unwrap() {
        assert!(
            serde_json::from_value::<ToolRequest>(value.clone()).is_err(),
            "{value}"
        );
    }

    let search = |length| json!({"tool": "search_files", "root_id": "root_moby", "query": "🌐".repeat(length), "max_results": 1});
    let reminder = |length| json!({"tool": "create_reminder", "text": "🌐".repeat(length), "due_at": "2026-11-03t14:00:00z"});
    round_trip::<ToolRequest>(&search(100));
    round_trip::<ToolRequest>(&reminder(200));
    assert!(serde_json::from_value::<ToolRequest>(search(101)).is_err());
    assert!(serde_json::from_value::<ToolRequest>(reminder(201)).is_err());

    let default_app = json!({"tool": "open_project", "project_id": "proj_moby"});
    let mut null_app = default_app.clone();
    null_app["app_id"] = Value::Null;
    let decoded: ToolRequest = serde_json::from_value(null_app).unwrap();
    assert_eq!(serde_json::to_value(decoded).unwrap(), default_app);
}

#[test]
fn agent_and_account_contracts_round_trip() {
    let fixture = fixtures();
    for value in fixture["agent_turn_requests"].as_array().unwrap() {
        round_trip::<AgentTurnRequest>(value);
    }
    for value in fixture["agent_turn_responses"].as_array().unwrap() {
        round_trip::<AgentTurnResponse>(value);
    }
    for value in fixture["tool_results"].as_array().unwrap() {
        round_trip::<ToolResult>(value);
    }
    for value in fixture["languages"].as_array().unwrap() {
        round_trip::<Language>(value);
    }
    for value in fixture["scripts"].as_array().unwrap() {
        round_trip::<Script>(value);
    }
    for value in fixture["consent_types"].as_array().unwrap() {
        round_trip::<ConsentType>(value);
    }
    round_trip::<UsageInfo>(&fixture["usage_info"]);
}

#[test]
fn local_time_is_optional_zoned_bounded_and_strict() {
    let fixture = fixtures();
    // The shared fixtures predate the field, so they cover the absent case.
    let without = &fixture["agent_turn_requests"][1];
    assert!(without.get("local_time").is_none());
    let decoded: AgentTurnRequest = serde_json::from_value(without.clone()).unwrap();
    assert!(decoded.local_time.is_none());
    assert!(
        serde_json::to_value(decoded)
            .unwrap()
            .get("local_time")
            .is_none()
    );

    let request = |value: Value| {
        let mut request = fixture["agent_turn_requests"][0].clone();
        request["local_time"] = value;
        serde_json::from_value::<AgentTurnRequest>(request)
    };
    for good in [
        "2026-11-05T09:30:00+05:00",
        "2026-11-05T04:30:00Z",
        "2026-11-05T09:30:00.123456789-03:30",
    ] {
        let decoded = request(json!(good)).unwrap();
        assert_eq!(decoded.local_time.unwrap().as_str(), good);
    }
    // Null counts as absent, like the other optional fields.
    assert!(request(Value::Null).unwrap().local_time.is_none());

    let oversized = format!("2026-11-05T09:30:00.{}+05:00", "1".repeat(20));
    for bad in [
        json!("2026-11-05T09:30:00"),
        json!("2026-11-05T09:30:00 +05:00"),
        json!("2026-11-05"),
        json!("09:30"),
        json!("not a time"),
        json!(""),
        json!("2026-13-05T09:30:00+05:00"),
        json!("2026-11-05T09:30:00.1234567890+05:00"),
        json!(oversized),
        json!(format!(
            "{}{}",
            "2026-11-05T09:30:00+05:00",
            " ".repeat(100)
        )),
        json!(1_762_300_200),
        json!(true),
    ] {
        assert!(request(bad.clone()).is_err(), "{bad}");
    }

    let mut unknown = fixture["agent_turn_requests"][0].clone();
    unknown["timezone"] = json!("Asia/Tashkent");
    assert!(serde_json::from_value::<AgentTurnRequest>(unknown).is_err());
}

#[test]
fn agent_rejects_unrecognized_roles_tools_and_payload_fields() {
    let fixture = fixtures();
    let mut request = fixture["agent_turn_requests"][0].clone();
    request["resources"][0]["path"] = json!("C:\\private");
    assert!(serde_json::from_value::<AgentTurnRequest>(request).is_err());

    let mut request = fixture["agent_turn_requests"][0].clone();
    request["available_tools"][0] = json!("run_shell");
    assert!(serde_json::from_value::<AgentTurnRequest>(request).is_err());

    let mut request = fixture["agent_turn_requests"][0].clone();
    request["messages"][0]["kind"] = json!("system");
    assert!(serde_json::from_value::<AgentTurnRequest>(request).is_err());

    let mut request = fixture["agent_turn_requests"][0].clone();
    request["language"] = json!("fr");
    assert!(serde_json::from_value::<AgentTurnRequest>(request).is_err());

    let mut response = fixture["agent_turn_responses"][1].clone();
    response["call"]["request"]["command"] = json!("whoami");
    assert!(serde_json::from_value::<AgentTurnResponse>(response).is_err());

    let mut result = fixture["tool_results"][1].clone();
    result["code"] = json!("unknown");
    assert!(serde_json::from_value::<ToolResult>(result).is_err());

    let mut usage = fixture["usage_info"].clone();
    usage["llm_tokens_remaining"] = json!(u64::from(u32::MAX) + 1);
    assert!(serde_json::from_value::<UsageInfo>(usage).is_err());
}

#[test]
fn unknown_tools_and_malformed_tags_are_rejected() {
    for value in [
        json!({"tool": "run_shell", "command": "whoami"}),
        json!({"tool": "open_url", "app_id": "editor"}),
        json!({"tool": "GitStatus", "project_id": "desk-project"}),
        json!({"project_id": "desk-project"}),
        json!({"tool": null}),
        json!({"tool": 1}),
    ] {
        assert!(serde_json::from_value::<ToolRequest>(value).is_err());
    }
    assert!(
        serde_json::from_str::<ToolRequest>(
            r#"{"tool":"open_app","app_id":"editor","app_id":"browser"}"#
        )
        .is_err()
    );
}

#[test]
fn nested_tool_errors_and_unexpected_message_fields_are_rejected() {
    let fixture = fixtures();
    let mut response = fixture["chat_response"].clone();
    response["tool_request"]["path"] = json!("C:\\private");
    assert!(serde_json::from_value::<ChatResponse>(response).is_err());
    let mut request = fixture["chat_request"].clone();
    request["provider_api_key"] = json!("not-a-key");
    assert!(serde_json::from_value::<ChatRequest>(request).is_err());
    let mut error = fixture["api_error"].clone();
    error["stack"] = json!("private");
    assert!(serde_json::from_value::<ApiError>(error).is_err());
    for value in [json!({}), json!({"text": null}), json!({"text": 1})] {
        assert!(serde_json::from_value::<ChatRequest>(value).is_err());
    }
}

#[test]
fn stable_id_constructor_and_serde_enforce_the_same_boundary() {
    for valid in ["a".to_owned(), "desk_2-project".to_owned(), "a".repeat(64)] {
        let id = StableId::new(valid.clone()).unwrap();
        assert_eq!(id.as_str(), valid);
        assert_eq!(id.to_string(), valid);
        assert_eq!(StableId::try_from(valid.clone()).unwrap(), id);
        assert_eq!(serde_json::to_value(id).unwrap(), json!(valid));
    }
    let fixture = fixtures();
    for value in fixture["invalid_ids"].as_array().unwrap() {
        assert!(StableId::new(value.as_str().unwrap()).is_err());
        assert!(serde_json::from_value::<StableId>(value.clone()).is_err());
    }
    let secret_like_input = "C:\\private\\secret";
    assert!(
        !StableId::new(secret_like_input)
            .unwrap_err()
            .to_string()
            .contains(secret_like_input)
    );
}

#[test]
fn package_version_matches_npm_and_cargo() {
    let package: Value = serde_json::from_str(include_str!("../package.json")).unwrap();
    assert_eq!(PACKAGE_VERSION, env!("CARGO_PKG_VERSION"));
    assert_eq!(package["version"], PACKAGE_VERSION);
    assert_eq!(PROTOCOL_VERSION, 1);
    assert_eq!(package["name"], "@mobyuz/moby-protocol");
}

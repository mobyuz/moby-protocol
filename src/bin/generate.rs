use std::{env, error::Error, fs, path::Path};

use moby_protocol::{
    AgentMessage, AgentTurnRequest, AgentTurnResponse, ApiError, ChatRequest, ChatResponse,
    ConsentType, Expression, Language, PACKAGE_VERSION, PROTOCOL_VERSION, ReminderText,
    ResourceKind, Script, SearchLimit, SearchQuery, StableId, ToolCall, ToolFailureCode, ToolName,
    ToolRequest, ToolResource, ToolResult, UsageInfo, ZonedDateTime, can_transition, usb,
};
use schemars::{JsonSchema, Schema, generate::SchemaSettings, transform::RecursiveTransform};
use serde_json::{Value, json};
use ts_rs::{Config, TS};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn schema<T: JsonSchema>() -> Result<String> {
    // Deserialization includes optional/null fields accepted by serde.
    let mut schema = SchemaSettings::draft2020_12()
        .for_deserialize()
        .with_transform(RecursiveTransform(|schema: &mut Schema| {
            // Bounds express these integers without validator-specific formats.
            if matches!(
                schema.get("format").and_then(Value::as_str),
                Some("uint8" | "uint32")
            ) {
                schema.remove("format");
            }
        }))
        .into_generator()
        .into_root_schema_for::<T>();
    schema.insert("x-package-version".into(), json!(PACKAGE_VERSION));
    Ok(format!("{}\n", serde_json::to_string_pretty(&schema)?))
}

fn artifacts() -> Result<Vec<(String, String)>> {
    let mut outputs = Vec::new();
    let mut typescript =
        String::from("// Generated from Rust. Run npm run generate; do not edit.\n\n");
    let config = Config::new();
    macro_rules! export {
        ($ty:ty) => {{
            typescript.push_str("export ");
            typescript.push_str(&<$ty>::decl(&config));
            typescript.push_str("\n\n");
        }};
        ($ty:ty, $name:literal) => {{
            outputs.push((format!("schema/{}.schema.json", $name), schema::<$ty>()?));
            export!($ty);
        }};
    }
    export!(StableId, "stable-id");
    export!(Expression, "expression");
    export!(ZonedDateTime);
    export!(SearchQuery);
    export!(SearchLimit);
    export!(ReminderText);
    export!(ToolName);
    export!(ChatRequest, "chat-request");
    export!(ToolRequest, "tool-request");
    export!(ToolCall);
    export!(ToolFailureCode);
    export!(ToolResult, "tool-result");
    export!(ChatResponse, "chat-response");
    export!(ApiError, "api-error");
    export!(Language, "language");
    export!(Script, "script");
    export!(ConsentType, "consent-type");
    export!(UsageInfo, "usage-info");
    export!(ResourceKind);
    export!(ToolResource);
    export!(AgentMessage);
    export!(AgentTurnRequest, "agent-turn-request");
    export!(AgentTurnResponse, "agent-turn-response");
    export!(usb::ControlVersion);
    export!(usb::EventKind);
    export!(usb::ResponseKind);
    export!(usb::Hello);
    export!(usb::HelloConfig);
    export!(usb::HelloAck);
    export!(usb::Heartbeat);
    export!(usb::ControlMessage, "usb-control");

    typescript.push_str(&format!(
        "export const PACKAGE_VERSION = {PACKAGE_VERSION:?} as const;\n\n"
    ));
    typescript.push_str(&format!(
        "export const PROTOCOL_VERSION = {PROTOCOL_VERSION} as const;\n\n"
    ));
    let usb_constants = [
        ("FRAME_VERSION", usb::FRAME_VERSION.into()),
        ("DELIMITER", usb::DELIMITER.into()),
        ("HEADER_LEN", usb::HEADER_LEN),
        ("CRC_LEN", usb::CRC_LEN),
        ("MAX_PAYLOAD_LEN", usb::MAX_PAYLOAD_LEN),
        ("MAX_DECODED_LEN", usb::MAX_DECODED_LEN),
        ("MAX_ENCODED_LEN", usb::MAX_ENCODED_LEN),
        ("MAX_WIRE_LEN", usb::MAX_WIRE_LEN),
        ("VERSION_OFFSET", usb::VERSION_OFFSET),
        ("KIND_OFFSET", usb::KIND_OFFSET),
        ("FLAGS_OFFSET", usb::FLAGS_OFFSET),
        ("RESERVED_OFFSET", usb::RESERVED_OFFSET),
        ("STREAM_ID_OFFSET", usb::STREAM_ID_OFFSET),
        ("SEQUENCE_OFFSET", usb::SEQUENCE_OFFSET),
        ("LENGTH_OFFSET", usb::LENGTH_OFFSET),
        ("CONTROL", usb::FrameKind::Control as usize),
        ("ROBOT_AUDIO", usb::FrameKind::RobotAudio as usize),
        ("DESKTOP_AUDIO", usb::FrameKind::DesktopAudio as usize),
    ];
    let mut usb_header = format!(
        "/* Generated from Rust. Run npm run generate. */\n\
         #ifndef MOBY_USB_H\n#define MOBY_USB_H\n\n\
         #define MOBY_USB_PROTOCOL_VERSION {PROTOCOL_VERSION}u\n"
    );
    typescript.push_str("export const USB = {\n");
    for (name, value) in usb_constants {
        typescript.push_str(&format!("  {name}: {value},\n"));
        usb_header.push_str(&format!("#define MOBY_USB_{name} {value}u\n"));
    }
    typescript.push_str("} as const;\n\n");
    usb_header.push_str("\n#endif /* MOBY_USB_H */\n");
    outputs.push(("include/moby_usb.h".into(), usb_header));

    let expressions = Expression::ALL
        .iter()
        .map(serde_json::to_string)
        .collect::<std::result::Result<Vec<_>, _>>()?;
    typescript.push_str(&format!(
        "export const EXPRESSIONS = [{}] as const satisfies readonly Expression[];\n\n",
        expressions.join(", ")
    ));
    typescript
        .push_str("const transitions: Readonly<Record<Expression, readonly Expression[]>> = {\n");
    for from in Expression::ALL {
        let allowed = Expression::ALL
            .iter()
            .filter(|&&to| can_transition(from, to))
            .map(serde_json::to_string)
            .collect::<std::result::Result<Vec<_>, _>>()?;
        typescript.push_str(&format!(
            "  {}: [{}],\n",
            serde_json::to_string(&from)?,
            allowed.join(", ")
        ));
    }
    typescript.push_str(
        "};\n\nexport function canTransition(from: Expression, to: Expression): boolean {\n  return transitions[from].includes(to);\n}\n",
    );
    outputs.push(("generated/index.ts".into(), typescript));
    Ok(outputs)
}

fn run() -> Result<()> {
    let args: Vec<_> = env::args().skip(1).collect();
    let check = match args.as_slice() {
        [] => false,
        [flag] if flag == "--check" => true,
        _ => return Err("usage: generate [--check]".into()),
    };
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let outputs = artifacts()?;
    let mut stale = false;
    for (relative, expected) in &outputs {
        let path = root.join(relative);
        if check {
            // Compare bytes so CRLF drift cannot silently differ from releases.
            if fs::read(&path).ok().as_deref() != Some(expected.as_bytes()) {
                eprintln!("out of date: {relative}");
                stale = true;
            }
        } else {
            fs::create_dir_all(path.parent().ok_or("missing artifact parent")?)?;
            fs::write(path, expected)?;
            println!("generated {relative}");
        }
    }
    // Renamed or removed types must not leave obsolete schema exports behind.
    if let Ok(entries) = fs::read_dir(root.join("schema")) {
        for entry in entries {
            let entry = entry?;
            let relative = format!("schema/{}", entry.file_name().to_string_lossy());
            if !outputs.iter().any(|(name, _)| name == &relative) {
                eprintln!("unexpected artifact (remove explicitly): {relative}");
                stale = true;
            }
        }
    }
    if stale {
        return Err("generated files differ; run npm run generate and commit the results".into());
    }
    if check {
        println!("all {} generated files are current", outputs.len());
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("generation failed: {error}");
        std::process::exit(1);
    }
}

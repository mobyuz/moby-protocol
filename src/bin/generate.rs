use std::{env, error::Error, fs, path::Path};

use moby_protocol::{
    ApiError, ChatRequest, ChatResponse, Expression, PROTOCOL_VERSION, StableId, ToolRequest,
    can_transition,
};
use schemars::{JsonSchema, generate::SchemaSettings};
use serde_json::json;
use ts_rs::{Config, TS};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn schema<T: JsonSchema>() -> Result<String> {
    // Deserialization includes optional/null fields accepted by serde.
    let mut schema = SchemaSettings::draft2020_12()
        .for_deserialize()
        .into_generator()
        .into_root_schema_for::<T>();
    schema.insert("x-protocol-version".into(), json!(PROTOCOL_VERSION));
    Ok(format!("{}\n", serde_json::to_string_pretty(&schema)?))
}

fn artifacts() -> Result<Vec<(String, String)>> {
    let mut outputs = Vec::new();
    let mut typescript =
        String::from("// Generated from Rust. Run npm run generate; do not edit.\n\n");
    let config = Config::new();
    macro_rules! export {
        ($ty:ty, $name:literal) => {{
            outputs.push((format!("schema/{}.schema.json", $name), schema::<$ty>()?));
            typescript.push_str("export ");
            typescript.push_str(&<$ty>::decl(&config));
            typescript.push_str("\n\n");
        }};
    }
    export!(StableId, "stable-id");
    export!(Expression, "expression");
    export!(ChatRequest, "chat-request");
    export!(ToolRequest, "tool-request");
    export!(ChatResponse, "chat-response");
    export!(ApiError, "api-error");

    typescript.push_str(&format!(
        "export const PROTOCOL_VERSION = {PROTOCOL_VERSION:?} as const;\n\n"
    ));
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

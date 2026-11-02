//! Shared wire types. This crate describes requests; it never executes tools.

mod expression;
mod stable_id;

pub use expression::{Expression, can_transition};
pub use stable_id::{InvalidStableId, StableId};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Must match the Cargo version, npm version, generated artifacts, and release tag.
pub const PROTOCOL_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Text submitted to the chat API. Limits and authentication belong to the API.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "generate", derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct ChatRequest {
    pub text: String,
}

/// A provider response. A tool request is untrusted input to the desktop validator.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "generate", derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct ChatResponse {
    pub reply: String,
    pub expression: Expression,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "generate", ts(optional = nullable))]
    pub tool_request: Option<ToolRequest>,
}

/// Declarative intent only. Every argument references a local registry entry.
///
/// IDs are not authorization: the desktop must resolve them through its own
/// allowlist and registries before invoking an executor. No raw paths, commands,
/// search expressions, or reminder content cross this tool boundary in v0.1.0.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "generate", derive(ts_rs::TS))]
#[serde(tag = "tool", rename_all = "snake_case", deny_unknown_fields)]
pub enum ToolRequest {
    GitStatus {
        project_id: StableId,
    },
    OpenApp {
        app_id: StableId,
    },
    OpenProject {
        project_id: StableId,
    },
    SearchFiles {
        project_id: StableId,
        query_id: StableId,
    },
    CreateReminder {
        reminder_id: StableId,
    },
}

/// Public error details. Callers must redact provider errors and credentials.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "generate", derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct ApiError {
    pub code: String,
    pub message: String,
    pub request_id: String,
}

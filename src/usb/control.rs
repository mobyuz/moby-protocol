use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{Expression, PROTOCOL_VERSION, StableId};

impl ControlVersion {
    pub const V1: Self = Self(1);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "generate", derive(ts_rs::TS))]
#[serde(try_from = "u32")]
#[schemars(!try_from, transparent)]
pub struct ControlVersion(#[schemars(extend("const" = ControlVersion::V1.0))] u32);

impl TryFrom<u32> for ControlVersion {
    type Error = &'static str;

    fn try_from(version: u32) -> Result<Self, Self::Error> {
        if version == Self::V1.0 {
            Ok(Self::V1)
        } else {
            Err("unsupported USB control envelope version")
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "generate", derive(ts_rs::TS))]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    Event,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "generate", derive(ts_rs::TS))]
#[serde(rename_all = "snake_case")]
pub enum ResponseKind {
    Response,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "generate", derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct Hello {
    pub device_id: StableId,
    pub hw_rev: String,
    pub fw_version: String,
    #[schemars(range(max = u32::MAX))]
    pub protocol_version: u32,
    pub capabilities: Vec<StableId>,
    pub mute: bool,
}

impl Hello {
    pub fn supports_protocol(&self) -> bool {
        self.protocol_version == PROTOCOL_VERSION
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "generate", derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct HelloConfig {}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "generate", derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct HelloAck {
    pub accepted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "generate", ts(optional = nullable))]
    pub session_id: Option<StableId>,
    pub config: HelloConfig,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "generate", derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct Heartbeat {
    pub state: Expression,
    pub mute: bool,
    #[schemars(range(max = u32::MAX))]
    pub uptime_ms: u32,
}

/// Control messages in the first USB v1 host slice.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "generate", derive(ts_rs::TS))]
#[serde(tag = "name", rename_all = "snake_case", deny_unknown_fields)]
pub enum ControlMessage {
    Hello {
        v: ControlVersion,
        kind: EventKind,
        id: StableId,
        #[schemars(range(max = u32::MAX))]
        ts_ms: u32,
        data: Hello,
    },
    HelloAck {
        v: ControlVersion,
        kind: ResponseKind,
        id: StableId,
        #[schemars(range(max = u32::MAX))]
        ts_ms: u32,
        data: HelloAck,
    },
    Heartbeat {
        v: ControlVersion,
        kind: EventKind,
        id: StableId,
        #[schemars(range(max = u32::MAX))]
        ts_ms: u32,
        data: Heartbeat,
    },
}

impl ControlMessage {
    /// Make a correlated response. The desktop supplies a session ID only
    /// when its local admission policy allows the device.
    pub fn acknowledge_hello(&self, session_id: Option<StableId>, ts_ms: u32) -> Option<Self> {
        let Self::Hello { v, id, data, .. } = self else {
            return None;
        };
        let session_id = session_id.filter(|_| data.supports_protocol());
        Some(Self::HelloAck {
            v: *v,
            kind: ResponseKind::Response,
            id: id.clone(),
            ts_ms,
            data: HelloAck {
                accepted: session_id.is_some(),
                session_id,
                config: HelloConfig::default(),
            },
        })
    }

    /// Read the session from an accepted response to the expected hello ID.
    pub fn accepted_session(&self, hello_id: &StableId) -> Option<&StableId> {
        match self {
            Self::HelloAck { id, data, .. } if id == hello_id && data.accepted => {
                data.session_id.as_ref()
            }
            _ => None,
        }
    }
}

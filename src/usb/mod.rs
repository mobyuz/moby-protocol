//! Host contract for the candidate USB v1 wire format.

mod control;
mod frame;

pub use control::{
    ControlMessage, ControlVersion, EventKind, Heartbeat, Hello, HelloAck, HelloConfig,
    ResponseKind,
};
pub use frame::{
    CRC_LEN, DELIMITER, FLAGS_OFFSET, FRAME_VERSION, Frame, FrameDecoder, FrameError, FrameKind,
    HEADER_LEN, KIND_OFFSET, LENGTH_OFFSET, MAX_DECODED_LEN, MAX_ENCODED_LEN, MAX_PAYLOAD_LEN,
    MAX_WIRE_LEN, RESERVED_OFFSET, SEQUENCE_OFFSET, STREAM_ID_OFFSET, VERSION_OFFSET,
};

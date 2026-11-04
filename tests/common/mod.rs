// Shared by the integration tests. Each test crate uses a different subset.
#![allow(dead_code)]

use moby_protocol::usb::{Frame, FrameDecoder, FrameError};

pub fn hex(value: &str) -> Vec<u8> {
    assert_eq!(value.len() % 2, 0);
    (0..value.len())
        .step_by(2)
        .map(|offset| u8::from_str_radix(&value[offset..offset + 2], 16).unwrap())
        .collect()
}

/// The tab-separated rows of a checked-in vector file, without its header.
pub fn rows(text: &'static str) -> Vec<Vec<&'static str>> {
    text.lines()
        .filter(|line| !line.starts_with('#'))
        .map(|line| line.split('\t').collect())
        .collect()
}

pub fn feed<'a>(decoder: &'a mut FrameDecoder, wire: &[u8]) -> Result<Frame<'a>, FrameError> {
    let (&delimiter, segment) = wire.split_last().unwrap();
    assert_eq!(delimiter, 0);
    for &byte in segment {
        assert!(decoder.push(byte).is_none());
    }
    decoder.push(delimiter).expect("segment ended")
}

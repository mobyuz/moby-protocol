#include "moby_usb.h"

#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uint16_t read_u16(const uint8_t *bytes) {
    return (uint16_t)(bytes[0] | ((uint16_t)bytes[1] << 8));
}

static uint32_t read_u32(const uint8_t *bytes) {
    return bytes[0] | ((uint32_t)bytes[1] << 8) | ((uint32_t)bytes[2] << 16) |
           ((uint32_t)bytes[3] << 24);
}

static uint32_t crc32_ieee(const uint8_t *bytes, size_t length) {
    uint32_t crc = UINT32_MAX;
    for (size_t i = 0; i < length; i++) {
        crc ^= bytes[i];
        for (unsigned bit = 0; bit < 8; bit++) {
            crc = (crc >> 1) ^ ((crc & 1u) ? UINT32_C(0xedb88320) : 0);
        }
    }
    return crc ^ UINT32_MAX;
}

static bool decode_cobs(const uint8_t *wire, size_t length,
                        uint8_t raw[MOBY_USB_MAX_DECODED_LEN], size_t *written) {
    if (length < 2 || length > MOBY_USB_MAX_WIRE_LEN ||
        wire[length - 1] != MOBY_USB_DELIMITER) {
        return false;
    }
    const size_t end = length - 1;
    size_t offset = 0;
    *written = 0;
    while (offset < end) {
        const uint8_t code = wire[offset++];
        if (code == 0) {
            return false;
        }
        const size_t count = (size_t)code - 1;
        const bool add_zero = code != 0xff && offset + count < end;
        if (count > end - offset ||
            count + add_zero > MOBY_USB_MAX_DECODED_LEN - *written ||
            memchr(wire + offset, 0, count)) {
            return false;
        }
        memcpy(raw + *written, wire + offset, count);
        *written += count;
        offset += count;
        if (add_zero) {
            raw[(*written)++] = MOBY_USB_DELIMITER;
        }
    }
    return true;
}

static const char *decode_frame(const uint8_t *wire, size_t length,
                                uint8_t raw[MOBY_USB_MAX_DECODED_LEN]) {
    size_t written;
    if (!decode_cobs(wire, length, raw, &written) ||
        written < MOBY_USB_HEADER_LEN + MOBY_USB_CRC_LEN) {
        return "bad_frame";
    }
    const size_t payload_length = read_u16(raw + MOBY_USB_LENGTH_OFFSET);
    const size_t body_end = MOBY_USB_HEADER_LEN + payload_length;
    if (payload_length > MOBY_USB_MAX_PAYLOAD_LEN ||
        written != body_end + MOBY_USB_CRC_LEN) {
        return "bad_frame";
    }
    if (crc32_ieee(raw, body_end) != read_u32(raw + body_end)) {
        return "bad_crc";
    }
    if (raw[MOBY_USB_VERSION_OFFSET] != MOBY_USB_FRAME_VERSION) {
        return "unsupported_version";
    }
    const uint8_t kind = raw[MOBY_USB_KIND_OFFSET];
    const uint16_t stream_id = read_u16(raw + MOBY_USB_STREAM_ID_OFFSET);
    if (raw[MOBY_USB_FLAGS_OFFSET] != 0 || raw[MOBY_USB_RESERVED_OFFSET] != 0 ||
        (kind != MOBY_USB_CONTROL && kind != MOBY_USB_ROBOT_AUDIO &&
         kind != MOBY_USB_DESKTOP_AUDIO) ||
        ((kind == MOBY_USB_CONTROL) != (stream_id == 0))) {
        return "bad_frame";
    }
    return "ok";
}

static unsigned hex_digit(char digit) {
    if (digit >= '0' && digit <= '9') {
        return (unsigned)(digit - '0');
    }
    assert(digit >= 'a' && digit <= 'f');
    return (unsigned)(digit - 'a' + 10);
}

static size_t from_hex(const char *text, uint8_t *bytes, size_t capacity) {
    const size_t length = strlen(text);
    assert(length % 2 == 0 && length / 2 <= capacity);
    for (size_t i = 0; i < length / 2; i++) {
        bytes[i] = (uint8_t)((hex_digit(text[2 * i]) << 4) | hex_digit(text[2 * i + 1]));
    }
    return length / 2;
}

int main(int argc, char **argv) {
    assert(argc == 2);
    assert(crc32_ieee((const uint8_t *)"123456789", 9) == UINT32_C(0xcbf43926));
    FILE *fixture = fopen(argv[1], "r");
    assert(fixture);
    char line[4 * MOBY_USB_MAX_WIRE_LEN + 128];
    size_t cases = 0;
    while (fgets(line, sizeof(line), fixture)) {
        if (line[0] == '#') {
            continue;
        }
        char *fields[7];
        fields[0] = strtok(line, "\t\r\n");
        for (size_t i = 1; i < 7; i++) {
            fields[i] = strtok(NULL, "\t\r\n");
            assert(fields[i]);
        }
        assert(fields[0] && !strtok(NULL, "\t\r\n"));

        uint8_t wire[MOBY_USB_MAX_WIRE_LEN];
        uint8_t raw[MOBY_USB_MAX_DECODED_LEN];
        const size_t length = from_hex(fields[6], wire, sizeof(wire));
        const char *actual = decode_frame(wire, length, raw);
        if (strcmp(actual, fields[1]) != 0) {
            fprintf(stderr, "%s: expected %s, got %s\n", fields[0], fields[1], actual);
            fclose(fixture);
            return 1;
        }
        if (strcmp(actual, "ok") == 0) {
            uint8_t payload[MOBY_USB_MAX_PAYLOAD_LEN];
            const size_t payload_length = from_hex(fields[5], payload, sizeof(payload));
            assert(raw[MOBY_USB_KIND_OFFSET] == strtoul(fields[2], NULL, 10));
            assert(read_u16(raw + MOBY_USB_STREAM_ID_OFFSET) == strtoul(fields[3], NULL, 10));
            assert(read_u32(raw + MOBY_USB_SEQUENCE_OFFSET) == strtoul(fields[4], NULL, 10));
            assert(read_u16(raw + MOBY_USB_LENGTH_OFFSET) == payload_length);
            assert(memcmp(raw + MOBY_USB_HEADER_LEN, payload, payload_length) == 0);
        }
        cases++;
    }
    assert(!ferror(fixture) && cases > 0);
    fclose(fixture);
    printf("C USB vectors passed (%zu cases)\n", cases);
    return 0;
}

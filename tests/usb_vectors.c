/*
 * Host test for the C codec. It reads the same vector files as the Rust and
 * TypeScript tests. Run: usb_vectors <path to tests/fixtures>
 * The codec has no JSON or HMAC, so control payloads are checked as bytes and
 * the proof input is checked, not the HMAC itself.
 */
#include "moby_usb_codec.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(condition)                                                                   \
    do {                                                                                   \
        if (!(condition)) {                                                                \
            fprintf(stderr, "%s:%d: check failed: %s\n", __FILE__, __LINE__, #condition); \
            exit(1);                                                                       \
        }                                                                                  \
    } while (0)

#define MAX_FIELDS 8
#define MAX_LINE 8192

static size_t from_hex(const char *text, uint8_t *bytes, size_t capacity) {
    const size_t length = strlen(text);
    CHECK(length % 2 == 0 && length / 2 <= capacity);
    CHECK(moby_hex_decode(text, length, bytes, length / 2));
    return length / 2;
}

/* Splits on tabs and keeps empty fields. Returns the number of fields. */
static size_t split_tabs(char *line, char **fields) {
    size_t count = 0;
    line[strcspn(line, "\r\n")] = '\0';
    fields[count++] = line;
    for (char *tab = strchr(line, '\t'); tab != NULL; tab = strchr(tab, '\t')) {
        CHECK(count < MAX_FIELDS);
        *tab++ = '\0';
        fields[count++] = tab;
    }
    return count;
}

typedef void (*row_handler)(char **fields, size_t count);

static size_t for_each_row(const char *directory, const char *name, row_handler handler) {
    char path[1024];
    CHECK(snprintf(path, sizeof(path), "%s/%s", directory, name) < (int)sizeof(path));
    FILE *file = fopen(path, "r");
    if (file == NULL) {
        fprintf(stderr, "cannot open %s\n", path);
        exit(1);
    }
    static char line[MAX_LINE];
    size_t rows = 0;
    while (fgets(line, sizeof(line), file) != NULL) {
        CHECK(strchr(line, '\n') != NULL || feof(file));
        if (line[0] == '#') {
            continue;
        }
        char *fields[MAX_FIELDS];
        handler(fields, split_tabs(line, fields));
        rows++;
    }
    CHECK(!ferror(file));
    fclose(file);
    CHECK(rows > 0);
    return rows;
}

/* Feeds a whole wire frame through the decoder and returns the last status. */
static moby_status decode_wire(moby_decoder *decoder, const uint8_t *wire, size_t length,
                               moby_frame *frame) {
    CHECK(length > 0 && wire[length - 1] == MOBY_USB_DELIMITER);
    for (size_t i = 0; i + 1 < length; i++) {
        CHECK(moby_decoder_push(decoder, wire[i], frame) == MOBY_PENDING);
    }
    return moby_decoder_push(decoder, wire[length - 1], frame);
}

static moby_status expected_status(const char *name) {
    if (strcmp(name, "ok") == 0) {
        return MOBY_OK;
    }
    if (strcmp(name, "bad_frame") == 0) {
        return MOBY_ERR_BAD_FRAME;
    }
    if (strcmp(name, "bad_crc") == 0) {
        return MOBY_ERR_BAD_CRC;
    }
    if (strcmp(name, "unsupported_version") == 0) {
        return MOBY_ERR_UNSUPPORTED_VERSION;
    }
    fprintf(stderr, "unknown outcome: %s\n", name);
    exit(1);
}

/* A decoded frame must match the row and must rebuild to the same wire bytes. */
static void check_frame(const char *name, const moby_frame *frame, unsigned long kind,
                        unsigned long stream, unsigned long sequence, const uint8_t *payload,
                        size_t payload_length, const uint8_t *wire, size_t wire_length) {
    if (frame->kind != kind || frame->stream_id != stream || frame->sequence != sequence ||
        frame->payload_length != payload_length ||
        memcmp(frame->payload, payload, payload_length) != 0) {
        fprintf(stderr, "%s: decoded frame differs from the vector\n", name);
        exit(1);
    }
    uint8_t rebuilt[MOBY_USB_MAX_WIRE_LEN];
    size_t rebuilt_length = 0;
    CHECK(moby_frame_build(frame->kind, frame->stream_id, frame->sequence, frame->payload,
                           frame->payload_length, rebuilt, sizeof(rebuilt),
                           &rebuilt_length) == MOBY_OK);
    if (rebuilt_length != wire_length || memcmp(rebuilt, wire, wire_length) != 0) {
        fprintf(stderr, "%s: rebuilt wire bytes differ from the vector\n", name);
        exit(1);
    }
}

static moby_decoder shared_decoder;

static void frame_row(char **fields, size_t count) {
    CHECK(count == 7);
    uint8_t wire[MOBY_USB_MAX_WIRE_LEN];
    uint8_t payload[MOBY_USB_MAX_PAYLOAD_LEN];
    const size_t wire_length = from_hex(fields[6], wire, sizeof(wire));
    moby_frame frame;
    const moby_status status = decode_wire(&shared_decoder, wire, wire_length, &frame);
    if (status != expected_status(fields[1])) {
        fprintf(stderr, "%s: expected %s, got status %d\n", fields[0], fields[1], (int)status);
        exit(1);
    }
    if (status == MOBY_OK) {
        const size_t payload_length = from_hex(fields[5], payload, sizeof(payload));
        check_frame(fields[0], &frame, strtoul(fields[2], NULL, 10), strtoul(fields[3], NULL, 10),
                    strtoul(fields[4], NULL, 10), payload, payload_length, wire, wire_length);
    }
}

static void control_row(char **fields, size_t count) {
    CHECK(count == 5);
    CHECK(strcmp(fields[1], "valid") == 0 || strcmp(fields[1], "invalid") == 0);
    uint8_t wire[MOBY_USB_MAX_WIRE_LEN];
    uint8_t payload[MOBY_USB_MAX_PAYLOAD_LEN];
    const size_t wire_length = from_hex(fields[4], wire, sizeof(wire));
    const size_t payload_length = from_hex(fields[3], payload, sizeof(payload));
    moby_frame frame;
    CHECK(decode_wire(&shared_decoder, wire, wire_length, &frame) == MOBY_OK);
    check_frame(fields[0], &frame, MOBY_USB_CONTROL, 0, strtoul(fields[2], NULL, 10), payload,
                payload_length, wire, wire_length);
    /* Every control message is a JSON object that names itself. */
    CHECK(payload_length > 2 && payload[0] == '{' && payload[payload_length - 1] == '}');
    CHECK(memchr(payload, '\n', payload_length) == NULL);
}

static void cobs_row(char **fields, size_t count) {
    CHECK(count == 3);
    uint8_t raw[MOBY_USB_MAX_DECODED_LEN];
    uint8_t encoded[MOBY_USB_MAX_ENCODED_LEN];
    const size_t raw_length = from_hex(fields[1], raw, sizeof(raw));
    const size_t encoded_length = from_hex(fields[2], encoded, sizeof(encoded));
    uint8_t output[MOBY_USB_MAX_ENCODED_LEN];
    size_t output_length = 0;
    CHECK(moby_cobs_encode(raw, raw_length, output, sizeof(output), &output_length) == MOBY_OK);
    if (output_length != encoded_length || memcmp(output, encoded, encoded_length) != 0) {
        fprintf(stderr, "%s: encoding differs from the vector\n", fields[0]);
        exit(1);
    }
    CHECK(output_length <= moby_cobs_max_encoded_len(raw_length));
    uint8_t decoded[MOBY_USB_MAX_DECODED_LEN];
    size_t decoded_length = 0;
    CHECK(moby_cobs_decode(encoded, encoded_length, decoded, sizeof(decoded),
                           &decoded_length) == MOBY_OK);
    CHECK(decoded_length == raw_length && memcmp(decoded, raw, raw_length) == 0);
    /* Decoding in place gives the same bytes. */
    memcpy(output, encoded, encoded_length);
    CHECK(moby_cobs_decode(output, encoded_length, output, sizeof(output), &decoded_length) ==
          MOBY_OK);
    CHECK(decoded_length == raw_length && memcmp(output, raw, raw_length) == 0);
}

static void hmac_row(char **fields, size_t count) {
    /* The device verifies these with mbedTLS; the codec only checks the file shape. */
    CHECK(count == 4);
    uint8_t buffer[256];
    CHECK(from_hex(fields[1], buffer, sizeof(buffer)) > 0);
    CHECK(from_hex(fields[2], buffer, sizeof(buffer)) > 0);
    CHECK(from_hex(fields[3], buffer, sizeof(buffer)) == 32);
}

static void proof_row(char **fields, size_t count) {
    CHECK(count == 7);
    uint8_t key[MOBY_USB_PAIR_KEY_BYTES];
    uint8_t nonce[MOBY_USB_NONCE_BYTES];
    uint8_t expected[256];
    uint8_t proof[MOBY_USB_PROOF_BYTES];
    CHECK(from_hex(fields[1], key, sizeof(key)) == sizeof(key));
    CHECK(from_hex(fields[2], nonce, sizeof(nonce)) == sizeof(nonce));
    const size_t expected_length = from_hex(fields[5], expected, sizeof(expected));
    CHECK(from_hex(fields[6], proof, sizeof(proof)) == sizeof(proof));
    uint8_t input[256];
    size_t input_length = 0;
    CHECK(moby_session_proof_input(nonce, fields[3], fields[4], input, sizeof(input),
                                   &input_length) == MOBY_OK);
    if (input_length != expected_length || memcmp(input, expected, expected_length) != 0) {
        fprintf(stderr, "%s: proof input differs from the vector\n", fields[0]);
        exit(1);
    }
    CHECK(moby_ct_equal(proof, proof, sizeof(proof)));
    CHECK(moby_session_proof_input(nonce, fields[3], fields[4], input, input_length - 1,
                                   &input_length) == MOBY_ERR_OUTPUT_TOO_SMALL);
}

static void robot_proof_row(char **fields, size_t count) {
    CHECK(count == 8);
    uint8_t key[MOBY_USB_PAIR_KEY_BYTES];
    uint8_t desktop_nonce[MOBY_USB_NONCE_BYTES];
    uint8_t robot_nonce[MOBY_USB_NONCE_BYTES];
    uint8_t expected[256];
    uint8_t proof[MOBY_USB_PROOF_BYTES];
    CHECK(from_hex(fields[1], key, sizeof(key)) == sizeof(key));
    CHECK(from_hex(fields[2], desktop_nonce, sizeof(desktop_nonce)) == sizeof(desktop_nonce));
    CHECK(from_hex(fields[3], robot_nonce, sizeof(robot_nonce)) == sizeof(robot_nonce));
    const size_t expected_length = from_hex(fields[6], expected, sizeof(expected));
    CHECK(from_hex(fields[7], proof, sizeof(proof)) == sizeof(proof));
    uint8_t input[256];
    size_t input_length = 0;
    CHECK(moby_robot_proof_input(desktop_nonce, robot_nonce, fields[4], fields[5], input,
                                 sizeof(input), &input_length) == MOBY_OK);
    if (input_length != expected_length || memcmp(input, expected, expected_length) != 0) {
        fprintf(stderr, "%s: robot proof input differs from the vector\n", fields[0]);
        exit(1);
    }
    CHECK(moby_robot_proof_input(desktop_nonce, robot_nonce, fields[4], fields[5], input,
                                 input_length - 1, &input_length) == MOBY_ERR_OUTPUT_TOO_SMALL);
    CHECK(moby_robot_proof_input(NULL, robot_nonce, fields[4], fields[5], input, sizeof(input),
                                 &input_length) == MOBY_ERR_BAD_ARGUMENT);
    CHECK(moby_robot_proof_input(desktop_nonce, robot_nonce, "", fields[5], input,
                                 sizeof(input), &input_length) == MOBY_ERR_BAD_ARGUMENT);
}

/* The desktop and robot proof inputs of one row differ, first at the stated byte. */
static void reflection_row(char **fields, size_t count) {
    CHECK(count == 7);
    uint8_t desktop[256];
    uint8_t robot[256];
    uint8_t proof[MOBY_USB_PROOF_BYTES];
    const size_t desktop_length = from_hex(fields[2], desktop, sizeof(desktop));
    CHECK(from_hex(fields[3], proof, sizeof(proof)) == sizeof(proof));
    const size_t robot_length = from_hex(fields[4], robot, sizeof(robot));
    CHECK(from_hex(fields[5], proof, sizeof(proof)) == sizeof(proof));
    size_t difference = 0;
    while (difference < desktop_length && difference < robot_length &&
           desktop[difference] == robot[difference]) {
        difference++;
    }
    CHECK(difference < desktop_length || difference < robot_length);
    CHECK(difference == (size_t)strtoul(fields[6], NULL, 10));
    /* A robot input starts with the label and a zero byte. */
    CHECK(robot_length > MOBY_USB_ROBOT_PROOF_LABEL_LEN + 1);
    CHECK(memcmp(robot, MOBY_USB_ROBOT_PROOF_LABEL, MOBY_USB_ROBOT_PROOF_LABEL_LEN) == 0);
    CHECK(robot[MOBY_USB_ROBOT_PROOF_LABEL_LEN] == 0);
}

static size_t transition_index;

static void transition_row(char **fields, size_t count) {
    CHECK(count == 2);
    CHECK(transition_index < MOBY_EXPRESSION_COUNT);
    CHECK(strlen(fields[1]) == MOBY_EXPRESSION_COUNT);
    CHECK(strcmp(moby_expression_name((moby_expression)transition_index), fields[0]) == 0);
    for (size_t to = 0; to < MOBY_EXPRESSION_COUNT; to++) {
        const bool expected = fields[1][to] == '1';
        if (moby_can_transition((moby_expression)transition_index, (moby_expression)to) !=
            expected) {
            fprintf(stderr, "%s -> %s differs from the vector\n", fields[0],
                    moby_expression_name((moby_expression)to));
            exit(1);
        }
    }
    transition_index++;
}

static void check_crc(void) {
    CHECK(moby_crc32((const uint8_t *)"123456789", 9) == UINT32_C(0xcbf43926));
    CHECK(moby_crc32(NULL, 0) == 0);
    const uint8_t *text = (const uint8_t *)"123456789";
    CHECK(moby_crc32_update(moby_crc32(text, 4), text + 4, 5) == UINT32_C(0xcbf43926));
}

static void check_decoder_recovery(void) {
    uint8_t payload[MOBY_USB_MAX_PAYLOAD_LEN];
    memset(payload, 0xa7, sizeof(payload));
    uint8_t wire[MOBY_USB_MAX_WIRE_LEN];
    size_t wire_length = 0;
    CHECK(moby_frame_build(MOBY_USB_ROBOT_AUDIO, 1, 0, payload, sizeof(payload), wire,
                           sizeof(wire), &wire_length) == MOBY_OK);
    moby_decoder decoder;
    moby_decoder_reset(&decoder);
    moby_frame frame;

    /* An idle delimiter is not an error. */
    CHECK(moby_decoder_push(&decoder, 0, &frame) == MOBY_PENDING);
    /* A segment past the limit is dropped through its delimiter. */
    for (size_t i = 0; i < MOBY_USB_MAX_ENCODED_LEN + 1000; i++) {
        CHECK(moby_decoder_push(&decoder, 0xff, &frame) == MOBY_PENDING);
    }
    CHECK(moby_decoder_push(&decoder, 0, &frame) == MOBY_ERR_FRAME_TOO_LARGE);
    CHECK(decode_wire(&decoder, wire, wire_length, &frame) == MOBY_OK);
    CHECK(frame.payload_length == sizeof(payload) && frame.payload[0] == 0xa7);

    /* A truncated block is rejected, and the next frame still decodes. */
    CHECK(moby_decoder_push(&decoder, 0xff, &frame) == MOBY_PENDING);
    CHECK(moby_decoder_push(&decoder, 0, &frame) == MOBY_ERR_BAD_FRAME);
    CHECK(decode_wire(&decoder, wire, wire_length, &frame) == MOBY_OK);

    /* A segment that fits but decodes past the decoded limit is a bad frame. */
    for (size_t i = 0; i < MOBY_USB_MAX_ENCODED_LEN; i++) {
        CHECK(moby_decoder_push(&decoder, 1, &frame) == MOBY_PENDING);
    }
    CHECK(moby_decoder_push(&decoder, 0, &frame) == MOBY_ERR_BAD_FRAME);

    /* A reset drops a partial frame. */
    for (size_t i = 0; i < 10; i++) {
        CHECK(moby_decoder_push(&decoder, wire[i], &frame) == MOBY_PENDING);
    }
    moby_decoder_reset(&decoder);
    CHECK(decode_wire(&decoder, wire, wire_length, &frame) == MOBY_OK);
}

static void check_build_limits(void) {
    uint8_t payload[MOBY_USB_MAX_PAYLOAD_LEN + 1] = {0};
    uint8_t wire[MOBY_USB_MAX_WIRE_LEN];
    size_t length = 0;
    CHECK(moby_frame_build(MOBY_USB_ROBOT_AUDIO, 1, 0, payload, 4, wire, 0, &length) ==
          MOBY_ERR_OUTPUT_TOO_SMALL);
    CHECK(moby_frame_build(MOBY_USB_ROBOT_AUDIO, 1, 0, payload, 4, wire, 1, &length) ==
          MOBY_ERR_OUTPUT_TOO_SMALL);
    CHECK(moby_frame_build(MOBY_USB_ROBOT_AUDIO, 1, 0, payload, 4, wire, 3, &length) ==
          MOBY_ERR_OUTPUT_TOO_SMALL);
    CHECK(moby_frame_build(MOBY_USB_ROBOT_AUDIO, 1, 0, payload, sizeof(payload), wire,
                           sizeof(wire), &length) == MOBY_ERR_FRAME_TOO_LARGE);
    CHECK(moby_frame_build(MOBY_USB_ROBOT_AUDIO, 0, 0, payload, 4, wire, sizeof(wire),
                           &length) == MOBY_ERR_BAD_FRAME);
    CHECK(moby_frame_build(MOBY_USB_CONTROL, 1, 0, payload, 4, wire, sizeof(wire), &length) ==
          MOBY_ERR_BAD_FRAME);
    CHECK(moby_frame_build(9, 0, 0, payload, 4, wire, sizeof(wire), &length) ==
          MOBY_ERR_BAD_FRAME);
    CHECK(moby_frame_build(MOBY_USB_CONTROL, 0, 0, NULL, 1, wire, sizeof(wire), &length) ==
          MOBY_ERR_BAD_ARGUMENT);
    /* The smallest buffer that holds a short frame is exactly its wire size. */
    CHECK(moby_frame_build(MOBY_USB_CONTROL, 0, 5, payload, 0, wire, sizeof(wire), &length) ==
          MOBY_OK);
    const size_t exact = length;
    CHECK(moby_frame_build(MOBY_USB_CONTROL, 0, 5, payload, 0, wire, exact, &length) == MOBY_OK);
    CHECK(moby_frame_build(MOBY_USB_CONTROL, 0, 5, payload, 0, wire, exact - 1, &length) ==
          MOBY_ERR_OUTPUT_TOO_SMALL);
}

/* Every payload length round trips, with and without embedded zero bytes. */
static void check_all_lengths(void) {
    uint8_t payload[MOBY_USB_MAX_PAYLOAD_LEN];
    uint8_t wire[MOBY_USB_MAX_WIRE_LEN];
    moby_decoder decoder;
    moby_decoder_reset(&decoder);
    for (unsigned pass = 0; pass < 2; pass++) {
        memset(payload, 0xa5, sizeof(payload));
        if (pass == 1) {
            for (size_t i = 0; i < sizeof(payload); i += 7) {
                payload[i] = 0;
            }
        }
        for (size_t length = 0; length <= MOBY_USB_MAX_PAYLOAD_LEN; length++) {
            size_t wire_length = 0;
            CHECK(moby_frame_build(MOBY_USB_DESKTOP_AUDIO, 2, (uint32_t)length, payload, length,
                                   wire, sizeof(wire), &wire_length) == MOBY_OK);
            moby_frame frame;
            CHECK(decode_wire(&decoder, wire, wire_length, &frame) == MOBY_OK);
            CHECK(frame.kind == MOBY_USB_DESKTOP_AUDIO && frame.stream_id == 2);
            CHECK(frame.sequence == length && frame.payload_length == length);
            CHECK(memcmp(frame.payload, payload, length) == 0);
        }
    }
}

static void check_helpers(void) {
    CHECK(moby_stable_id_valid("a"));
    CHECK(moby_stable_id_valid("dev_123e4567-e89b-42d3-a456-426614174000"));
    char longest[65];
    memset(longest, 'a', 64);
    longest[64] = '\0';
    CHECK(moby_stable_id_valid(longest));
    char too_long[66];
    memset(too_long, 'a', 65);
    too_long[65] = '\0';
    CHECK(!moby_stable_id_valid(too_long));
    CHECK(!moby_stable_id_valid(""));
    CHECK(!moby_stable_id_valid(NULL));
    CHECK(!moby_stable_id_valid("1abc"));
    CHECK(!moby_stable_id_valid("Abc"));
    CHECK(!moby_stable_id_valid("a.b"));
    CHECK(!moby_stable_id_valid("a b"));
    CHECK(!moby_stable_id_valid("a/b"));

    uint8_t bytes[4];
    CHECK(moby_hex_decode("00ff10ab", 8, bytes, 4) && bytes[1] == 0xff && bytes[3] == 0xab);
    CHECK(!moby_hex_decode("00FF10AB", 8, bytes, 4));
    CHECK(!moby_hex_decode("00ff10a", 7, bytes, 4));
    CHECK(!moby_hex_decode("00ff10abcd", 10, bytes, 4));
    CHECK(!moby_hex_decode("00ff10ag", 8, bytes, 4));
    char text[9] = {0};
    moby_hex_encode(bytes, 4, text);
    CHECK(strcmp(text, "00ff10ab") == 0);
    CHECK(moby_ct_equal(bytes, bytes, 4));
    const uint8_t other[4] = {0, 0xff, 0x10, 0xac};
    CHECK(!moby_ct_equal(bytes, other, 4));
}

static void check_cobs_errors(void) {
    uint8_t output[16];
    size_t length = 0;
    CHECK(moby_cobs_decode((const uint8_t *)"\x00", 1, output, sizeof(output), &length) ==
          MOBY_ERR_BAD_FRAME);
    CHECK(moby_cobs_decode((const uint8_t *)"\x05\x01", 2, output, sizeof(output), &length) ==
          MOBY_ERR_BAD_FRAME);
    CHECK(moby_cobs_decode((const uint8_t *)"\x03\x00\x01", 3, output, sizeof(output), &length) ==
          MOBY_ERR_BAD_FRAME);
    CHECK(moby_cobs_decode((const uint8_t *)"\x04\x01\x02\x03", 4, output, 2, &length) ==
          MOBY_ERR_OUTPUT_TOO_SMALL);
    CHECK(moby_cobs_encode((const uint8_t *)"\x01\x02\x03", 3, output, 3, &length) ==
          MOBY_ERR_OUTPUT_TOO_SMALL);
    CHECK(moby_cobs_encode((const uint8_t *)"\x01\x02\x03", 3, output, 4, &length) == MOBY_OK &&
          length == 4);
    CHECK(moby_cobs_encode(NULL, 0, output, 1, &length) == MOBY_OK && length == 1 &&
          output[0] == 1);
    CHECK(moby_cobs_encode(NULL, 0, output, 0, &length) == MOBY_ERR_OUTPUT_TOO_SMALL);
}

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "usage: %s <fixtures directory>\n", argv[0]);
        return 2;
    }
    check_crc();
    moby_decoder_reset(&shared_decoder);
    const size_t frames = for_each_row(argv[1], "usb-vectors.tsv", frame_row);
    const size_t controls = for_each_row(argv[1], "control-vectors.tsv", control_row);
    const size_t cobs = for_each_row(argv[1], "cobs-vectors.tsv", cobs_row);
    const size_t hmacs = for_each_row(argv[1], "hmac-vectors.tsv", hmac_row);
    const size_t proofs = for_each_row(argv[1], "proof-vectors.tsv", proof_row);
    const size_t robot_proofs = for_each_row(argv[1], "robot-proof-vectors.tsv", robot_proof_row);
    const size_t reflections = for_each_row(argv[1], "reflection-vectors.tsv", reflection_row);
    const size_t transitions = for_each_row(argv[1], "transition-vectors.tsv", transition_row);
    CHECK(transition_index == MOBY_EXPRESSION_COUNT);
    check_decoder_recovery();
    check_build_limits();
    check_all_lengths();
    check_helpers();
    check_cobs_errors();
    printf("C codec passed: %zu frame, %zu control, %zu COBS, %zu HMAC, %zu proof, %zu robot proof, "
           "%zu reflection, %zu transition rows\n",
           frames, controls, cobs, hmacs, proofs, robot_proofs, reflections, transitions);
    return 0;
}

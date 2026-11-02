# Verification recorded on 2026-11-02

These are excerpts from commands actually run in the Windows checkout at
`D:\repos\moby\moby-protocol`. Timings are observations, not performance claims.
Installation instructions for a fresh Windows system were not executed on a
clean machine. Hosted CI results are reported separately after pushing.

## Toolchain

```text
rustc 1.98.1 (48a229cea 2026-09-01)
cargo 1.98.1 (797e8a9bc 2026-08-05)
v24.13.0
11.6.2
git version 2.53.0.windows.1
gh version 2.96.0 (2026-07-02)
```

Pinned development libraries: Serde 1.0.229, serde_json 1.0.154, Schemars 1.2.3,
ts-rs 12.0.1, TypeScript 7.0.2, Ajv 8.20.0. Both lockfiles are committed.
`cargo fmt --all -- --check` exited 0 with no output. Strict Clippy exited 0:

```text
> cargo clippy --locked --all-targets --all-features -- -D warnings
    Checking moby-protocol v0.1.0 (D:\repos\moby\moby-protocol)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.44s
```

## Rust contracts

```text
> cargo test --locked --all-targets --all-features
running 9 tests
test text_chat_and_failure_recovery_flows ... ok
test protocol_version_matches_npm_and_cargo ... ok
test stable_id_constructor_and_serde_enforce_the_same_boundary ... ok
test every_expression_has_a_stable_wire_name_and_round_trips ... ok
test nested_tool_errors_and_unexpected_message_fields_are_rejected ... ok
test unknown_tools_and_malformed_tags_are_rejected ... ok
test messages_round_trip_against_shared_wire_fixtures ... ok
test transition_table_covers_all_81_pairs ... ok
test all_tools_round_trip_and_reject_extra_fields_missing_ids_and_paths ... ok

test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

The default consumer configuration was also tested:

```text
> cargo test --locked --no-default-features
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

The library also built in optimized mode without the generation feature:

```text
> cargo build --locked --release --no-default-features
   Compiling moby-protocol v0.1.0 (D:\repos\moby\moby-protocol)
    Finished `release` profile [optimized] target(s) in 9.59s
```

## TypeScript build and schema parity

```text
> npm.cmd test
> @mobyuz/moby-protocol@0.1.0 test
> npm run build && npm run test:types && node --test tests/*.test.mjs

> @mobyuz/moby-protocol@0.1.0 build
> tsc -p tsconfig.json

> @mobyuz/moby-protocol@0.1.0 test:types
> tsc -p tsconfig.test.json

✔ release guard checks real Cargo/npm/lockfile/generated versions and changelog (98.9484ms)
✔ release guard refuses mismatched versions, branches, and shell-like tag input (248.1826ms)
✔ all shared Rust wire fixtures validate against generated JSON Schema (3.8383ms)
✔ schemas reject unknown tools, extra fields, missing arguments, and path-like IDs (1.2036ms)
✔ nested tool validation and strict message envelopes match Rust (0.19ms)
✔ generated JavaScript agrees with the exhaustive 81-pair transition table (1.3753ms)
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 733.3455
```

## Generation check and deliberate failure probe

A temporary comment was appended to `generated/index.ts`, then the generation
check was run. The original bytes were restored in a `finally` block and the
check was repeated. The failure below is intentional, demonstrating drift
detection; the restored tree passes:

```text
> cargo run --locked --features generate --bin generate -- --check
out of date: generated/index.ts
generation failed: generated files differ; run npm run generate and commit the results
error: process didn't exit successfully: `target\debug\generate.exe --check` (exit code: 1)
Drift probe rejected modified TypeScript with exit code 1

> cargo run --locked --features generate --bin generate -- --check
all 7 generated files are current
```

## Workflow lint and package inspection

Official actionlint v1.7.12 was downloaded from `rhysd/actionlint` and its ZIP
SHA-256 checked against that release's checksums file. Running actionlint over
all three workflow files exited 0 with no diagnostics.

`npm.cmd pack --dry-run` exited 0 after generation verification and compilation.
Selected actual output (the tarball is a dry run and was not published):

```text
npm notice name: @mobyuz/moby-protocol
npm notice version: 0.1.0
npm notice filename: mobyuz-moby-protocol-0.1.0.tgz
npm notice package size: 6.6 kB
npm notice unpacked size: 21.0 kB
npm notice total files: 12
```

The file list contains only the README, changelog, license placeholder,
`package.json`, ESM/declaration outputs, and six schemas. No credentials,
`.npmrc`, `.env`, test fixtures, generator executable, or provider keys enter
the npm tarball. Package publication and first-tag Release behavior remain
unverified until a maintainer performs a release.

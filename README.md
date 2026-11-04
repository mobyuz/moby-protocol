# moby-protocol

The shared wire contract for Moby, an ESP32-S3 desk companion. This is one
independent repository under `mobyuz`; it contains no other Moby repositories.
Rust is the source of truth for types, JSON Schema, the protocol version, and
state transitions. The npm package is `@mobyuz/moby-protocol`.

The working version is **0.2.0**. A tag and published package are created only
through the release process below.

## Windows setup (PowerShell, x64)

Install Git, GitHub CLI, Rustup, and the Windows MSVC build tools if absent:

```powershell
winget install --exact --id Git.Git --version 2.53.0
winget install --exact --id GitHub.cli --version 2.96.0
winget install --exact --id Rustlang.Rustup
winget install --exact --id Microsoft.VisualStudio.2022.BuildTools --override '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
```

Open a new PowerShell terminal after installation. Install the exact Node
toolchain from the official archive (Node x64; use the arm64 archive on ARM):

```powershell
Invoke-WebRequest 'https://nodejs.org/dist/v24.13.0/node-v24.13.0-win-x64.zip' -OutFile "$env:TEMP\moby-node-24.13.0.zip"
Expand-Archive -LiteralPath "$env:TEMP\moby-node-24.13.0.zip" -DestinationPath "$env:LOCALAPPDATA\Moby\tools" -Force
$env:Path = "$env:LOCALAPPDATA\Moby\tools\node-v24.13.0-win-x64;$env:Path"
npm.cmd install --global npm@11.6.2
node --version
npm.cmd --version
```

The PATH change is for this terminal; repeat it in a new terminal or add that
directory to your user PATH. Authenticate with an account granted access to the
organization; never place a credential in a clone URL:

```powershell
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
New-Item -ItemType Directory -Path D:\repos\moby -Force | Out-Null
Set-Location D:\repos\moby
gh repo clone mobyuz/moby-protocol
Set-Location .\moby-protocol
rustup toolchain install 1.98.1 --profile minimal --component rustfmt --component clippy
rustc --version
cargo --version
npm.cmd ci --ignore-scripts --no-audit --no-fund
```

If already cloned, enter your existing checkout instead of cloning again.
Rustup reads `rust-toolchain.toml`. `npm.cmd` avoids the Windows PowerShell
execution-policy restriction on `npm.ps1`. npm does not read `.env` files;
`.env.example` documents the optional process environment variable.
No provider key or GitHub Packages token is required for local tests because
all development dependencies come from public registries.

## Build, generate, and test

Run from the repository root:

```powershell
cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-targets --all-features
cargo test --locked --no-default-features
npm.cmd run generate:check
npm.cmd test
npm.cmd pack --dry-run
```

`npm test` builds the ESM package and declarations, checks positive/negative
TypeScript consumer examples, validates wire fixtures against JSON Schema using
Ajv 2020, checks all 81 JavaScript transitions, and verifies release metadata.
See [recorded verification](docs/verification.md) for commands actually run.

After editing Rust contract types or transitions:

```powershell
npm.cmd run generate
npm.cmd test
git diff -- generated schema include
```

Commit the generated artifacts. `generate:check` compares bytes without
rewriting files and fails on missing, stale, or unexpected schema files. It uses
an explicit generator configuration; environment variables cannot alter its
output. `.gitattributes` preserves LF on Windows. Generation requires the
`generate` Cargo feature; normal Rust consumers do not pull in `ts-rs`.

The USB tests share the vector files in `tests/fixtures/`, which
`scripts/make-usb-vectors.mjs` writes. Rust and Node run them through the
commands above. Ubuntu CI also builds the dependency-free C codec in `c/`
(header `include/moby_usb_codec.h`) and runs the C host test over the same
files:

```sh
cc -std=c11 -Wall -Wextra -Werror -pedantic -I include c/moby_usb_codec.c tests/usb_vectors.c -o usb_vectors
./usb_vectors tests/fixtures
```

On Windows without GCC, compile the same two sources with MSVC from a
Developer PowerShell (`cl /std:c11 /W4 /WX /I include`). See the
[USB v1 decision record](docs/adr/0003-usb-v1-host-framing.md) for the frame
layout, the [protocol details](docs/protocol.md#usb-control-messages) for the
control messages, and the
[pairing decision](docs/adr/0004-pairing-and-session-auth.md).

## Consume a pinned release

Do this only after the referenced release exists. Rust consumers use a tag:

```toml
[dependencies]
moby-protocol = { git = "https://github.com/mobyuz/moby-protocol", tag = "v0.2.0" }
```

Commit consumer `Cargo.lock` files. See [authentication](docs/authentication.md)
for private Rust dependencies in CI.

Each npm consumer commits this `.npmrc` (also present in this repository):

```ini
@mobyuz:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
save-exact=true
```

Set `NODE_AUTH_TOKEN` in the process environment using a GitHub Packages token
(classic, `read:packages`, with access to the package). Read it without echoing:

```powershell
$env:NODE_AUTH_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host 'GitHub Packages read token' -AsSecureString)).Password
npm.cmd install --save-exact @mobyuz/moby-protocol@0.2.0
Remove-Item Env:\NODE_AUTH_TOKEN
```

Commit `package-lock.json`; do not use `latest`, ranges, branches, local paths,
or links to another checkout. Example TypeScript:

```typescript
import { canTransition, type AgentTurnResponse, type Expression } from "@mobyuz/moby-protocol";

const state: Expression = "disconnected";
const canReconnect = canTransition(state, "idle");
const event: AgentTurnResponse = { event: "completed", speech_text: "Salom!", expression_hint: "happy" };
```

Schemas are included in the npm package, for example
`@mobyuz/moby-protocol/schema/tool-request`. TypeScript provides compile-time
types; untrusted JSON must be runtime-validated with the schema or Rust decoder.
Enable full `date-time` validation for tool requests and usage timestamps.

## Contract and security

- `ChatRequest`: `{text}`.
- `ChatResponse`: `{reply, expression, tool_request?}`; missing or null tool
  requests deserialize to `None`, and `None` is omitted when serialized.
- `ApiError`: `{code, message, request_id}`.
- `ToolRequest`: tagged by `tool`. Resource references use validated IDs.
  Filename queries and reminder content have explicit bounds.
- `AgentTurnRequest` and `AgentTurnResponse`: stateless message history and
  stream events, including correlated tool calls and results.
- `PACKAGE_VERSION` matches Cargo, npm, schema metadata, and the release tag.
  `PROTOCOL_VERSION` is the integer for the robot handshake.

[Protocol details and transition table](docs/protocol.md) explain the chosen
policy and the local registries consumers must provide. Registry membership,
permissions, API request limits, and tool execution remain consumer duties.
The backend returns intent; only the desktop can approve local actions. This
library performs no I/O or tool execution. Provider keys belong only in the API's
environment and must never enter protocol messages, frontend bundles, or logs.

## Release

Before the first tag, confirm the protocol decisions. Review
[branch/tag protection](docs/branch-protection.md) and
[authentication and recovery](docs/authentication.md).

For each release, update Cargo and npm versions together, update both lockfiles,
regenerate, and add a dated changelog entry. All breaking protocol changes
require the next **major**, even during 0.x; consumers upgrade in separate PRs.
Prepare and merge that version change before tagging:

```powershell
cargo generate-lockfile
npm.cmd install --package-lock-only --ignore-scripts --no-audit --no-fund
npm.cmd run generate
cargo test --locked --all-targets --all-features
npm.cmd test
npm.cmd run check:release -- v0.2.0
git tag -a v0.2.0 -m 'moby-protocol v0.1.0'
git push origin v0.2.0
```

Substitute the new version in both tag commands. Tag pushes run the same
Windows/Linux checks as CI, enforce matching release versions and main ancestry,
pack the package, create a draft release with the npm tarball, JSON Schemas,
the USB C headers and codec, and wire vectors,
publish to GitHub Packages, and then publish the GitHub Release. The release
uses `GITHUB_TOKEN` with job-scoped `contents: write` and `packages: write`.
It never publishes to npmjs.com or crates.io. No release is triggered by `main`.

## License

[GNU General Public License version 3](LICENSE) (`GPL-3.0-only`).

Copyright (c) 2026 Moby contributors.

## Official references checked

- [Serde container attributes](https://serde.rs/container-attrs.html)
- [Schemars 1.2.3](https://docs.rs/schemars/1.2.3/schemars/)
- [ts-rs 12.0.1](https://docs.rs/ts-rs/12.0.1/ts_rs/)
- [time RFC 3339 parsing](https://docs.rs/time/latest/src/time/format_description/well_known/rfc3339.rs.html)
- [Ajv date-time validation](https://ajv.js.org/packages/ajv-formats.html)
- [GitHub's npm registry authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry)
- [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use)

Tauri, Axum, SQLx, utoipa, Vite, and Tailwind are outside this repository and
will be checked against their official docs when implementing their consumers.

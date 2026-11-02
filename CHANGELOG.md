# Changelog

Every release uses the same version in Cargo, npm, PROTOCOL_VERSION, generated
schemas, and the `vX.Y.Z` tag. Breaking wire or transition changes require a major
bump, including during 0.x. Each consuming repository upgrades in its own PR.

## [Unreleased]

## [0.1.0] - 2026-11-02

### Added

- Serde wire types for all nine expressions, chat messages, API errors, and the
  five explicitly tagged tool requests.
- Validated stable registry IDs; unknown tools and additional fields are rejected.
- Pure Rust transition policy with all 81 pairs covered by shared wire fixtures.
- Deterministic JSON Schema and TypeScript generation, including a JavaScript
  transition helper and the protocol version constant.
- Windows/Linux CI checks, tag-triggered GitHub Packages and GitHub Release
  workflow, pinned toolchains, and private-dependency authentication guidance.

This entry prepares v0.1.0; it does not assert that the tag or package exists.

# Changelog

Every release uses the same version in Cargo, npm, PACKAGE_VERSION, generated
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
  transition helper and distinct package and device version constants.
- Stateless agent turn and tool result types, language and script values,
  consent types, and remaining usage.
- Bounded filename search and reminder requests, zoned timestamp validation,
  and optional app selection when opening a project.
- Windows/Linux CI checks, tag-triggered GitHub Packages and GitHub Release
  workflow, pinned toolchains, and private-dependency authentication guidance.
- GNU General Public License version 3 (`GPL-3.0-only`).

This entry prepares v0.1.0; it does not assert that the tag or package exists.

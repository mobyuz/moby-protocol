# Repository protection notes

These are recommended repository settings. Committing this document does not
configure them, and availability can depend on the organization plan and
repository visibility. No settings should be claimed enabled without checking
the live repository.

For `main`, configure a branch ruleset that:

- Requires pull requests with zero required approvals during the
  single-maintainer phase.
- Requires conversation resolution.
- Requires both `checks / verify (ubuntu-24.04)` and
  `checks / verify (windows-2022)` from the CI workflow.
- Requires the branch to be up to date before merge, or use a merge queue only
  after adding the required `merge_group` trigger to CI.
- Blocks force pushes and deletions; restricts bypass to documented recovery.

For `v*` tags, configure a tag ruleset restricting creation to release
maintainers and blocking updates/deletions. Releases must tag a commit on
`main` that was merged through a pull request with passing CI. Do not move a
tag to repair a release; publish a new version.

CI grants only read permissions, avoids `pull_request_target`, and pins external
actions to full commit SHAs with their verified version in comments. The tag
release reuses the same checks before its publisher receives write permissions.
Use organization Actions policies to restrict allowed actions. Consumer upgrade
PRs must independently pass checks against the new pinned protocol release.

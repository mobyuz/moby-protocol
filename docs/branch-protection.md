# Repository protection notes

These are recommended repository settings. Committing this document does not
configure them, and availability can depend on the organization plan and
repository visibility. No settings should be claimed enabled without checking
the live repository.

For `main`, configure a branch ruleset that:

- Requires pull requests and at least one approving reviewer.
- Dismisses stale approvals and requires conversation resolution.
- Requires both `verify (ubuntu-24.04)` and `verify (windows-2022)` from the CI
  workflow. Select the exact check labels shown after the first successful run.
- Requires the branch to be up to date before merge, or use a merge queue only
  after adding the required `merge_group` trigger to CI.
- Blocks force pushes and deletions; restricts bypass to documented recovery.

Use the general approving review rule while the sole code owner also authors
changes. A separate reviewer with write access can approve those pull requests.

For `v*` tags, configure a tag ruleset restricting creation to release
maintainers and blocking updates/deletions. Releases must tag a reviewed commit
on `main`. Do not move a tag to repair a release; publish a new version.

CI grants only read permissions, avoids `pull_request_target`, and pins external
actions to full commit SHAs with their verified version in comments. The tag
release reuses the same checks before its publisher receives write permissions.
Use organization Actions policies to restrict allowed actions. Consumer upgrade
PRs must independently pass checks against the new pinned protocol release.

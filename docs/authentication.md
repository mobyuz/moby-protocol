# Private repository and package authentication

## This repository's workflows

`actions/checkout` reads this private repository with its ephemeral
`GITHUB_TOKEN`; credentials are not persisted. All Rust/npm development
dependencies are public. Pull-request CI needs only `contents: read` and no
custom secrets. No provider keys are used anywhere in this repository.

The release job uses its own `GITHUB_TOKEN` with `contents: write` and
`packages: write`. The token is passed only as `GH_TOKEN` for GitHub Release
steps and `NODE_AUTH_TOKEN` for npm publishing. `.npmrc` contains a literal
environment variable reference, never an actual token. The package repository
metadata associates the package with `mobyuz/moby-protocol`.

New GitHub Packages packages are private by default. Confirm organization
package creation policies and repository inheritance before first publishing.
Grant each consumer repository access under the package's **Manage Actions
access** settings. That permits its `GITHUB_TOKEN` with `packages: read` to
install an exact version without sharing a long-lived package token.

## Private Rust consumers: fine-grained token

The consumer workflow stores `MOBY_PROTOCOL_READ_TOKEN` as an Actions secret: a
fine-grained token restricted to `mobyuz/moby-protocol` with **Contents: read**,
approved by the organization if required. Grant no write permission. Configure
an ephemeral Git credential helper, and let Cargo use Git CLI fetching:

```yaml
- name: Configure protocol repository access
  shell: bash
  env:
    MOBY_PROTOCOL_READ_TOKEN: ${{ secrets.MOBY_PROTOCOL_READ_TOKEN }}
  run: |
    git config --global credential.https://github.com.helper ''
    git config --global --add credential.https://github.com.helper '!f() { printf "%s\n" "username=x-access-token" "password=$MOBY_PROTOCOL_READ_TOKEN"; }; f'
- name: Build with pinned protocol tag
  env:
    MOBY_PROTOCOL_READ_TOKEN: ${{ secrets.MOBY_PROTOCOL_READ_TOKEN }}
    CARGO_NET_GIT_FETCH_WITH_CLI: 'true'
  run: cargo build --locked
```

Use this only on ephemeral hosted runners; remove the helper after use on a
persistent runner. Do not enable shell tracing. The helper reads the token from
the build step's environment and returns it over Git's credential pipe; it does
not put a token in the clone URL or Git configuration. Alternatively, use a
read-only repository deploy key stored as an Actions secret and verified SSH
host keys; do not disable host-key checks. Keep the Rust dependency pinned to a
semver tag in either case.

## npm consumers

Commit a scope-specific `.npmrc` with the token environment reference:

```ini
@mobyuz:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
save-exact=true
```

In an explicitly granted consumer repository:

```yaml
permissions:
  contents: read
  packages: read
# In the dependency installation step:
# env:
#   NODE_AUTH_TOKEN: ${{ github.token }}
# run: npm ci --ignore-scripts
```

For local installs, use a PAT **classic** with `read:packages`, package access,
and organization SSO authorization if required. GitHub's npm registry does not
support fine-grained tokens; the fine-grained token described above is only for
Git repository access. If a cross-repository `GITHUB_TOKEN` grant is unavailable,
store a restricted-access classic token as `MOBY_PACKAGES_READ_TOKEN` in the
consumer's Actions secrets. Do not reuse the Git repository read token.

Never commit `.env`, real npm tokens, private keys, provider credentials, or
credential-bearing Git URLs. Never print environment variables or request
payloads into logs. Set `NODE_AUTH_TOKEN` in the environment; copying
`.env.example` alone does not configure npm.

## Release failure recovery

Publishing an npm version and a GitHub Release cannot be atomic. The workflow
creates a draft release before npm publishing, then publishes the release only
after npm succeeds. If publishing fails, keep the existing tag immutable.

1. Inspect the failed job and determine whether the exact npm version exists.
2. If the npm version does not exist, fix package permissions or organization
   policy and publish the draft's already-built tarball using the same identity
   and version. Do not rebuild different bytes for an existing version.
3. If the npm version exists, compare its integrity against the draft tarball
   and publish the existing draft after verification. Do not republish npm.
4. A workflow rerun stops at an already-existing draft or package; it does not
   overwrite either. Complete the verified remaining step manually. If the
   artifacts themselves were wrong, fix them in a new version and tag.

Sources: [GitHub npm registry authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry),
[package access](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility),
[fine-grained tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

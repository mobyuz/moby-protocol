import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PACKAGE_VERSION } from "@mobyuz/moby-protocol";

const script = fileURLToPath(new URL("../scripts/check-release.mjs", import.meta.url));
function check(tag) {
  return spawnSync(process.execPath, [script, tag], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: "" },
  });
}

test("release guard checks real Cargo/npm/lockfile/generated versions and changelog", () => {
  const result = check("v" + PACKAGE_VERSION);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /release metadata matches/);
});

test("release guard refuses mismatched versions, branches, and shell-like tag input", () => {
  for (const tag of ["v9.9.9", "v0.1.0-beta.1", "main", "v0.1.0; whoami"]) {
    assert.notEqual(check(tag).status, 0, tag);
  }
});

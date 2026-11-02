import assert from "node:assert/strict";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { PROTOCOL_VERSION } from "../dist/index.js";

const root = new URL("../", import.meta.url);
const args = process.argv.slice(2);
const writeNotes = args.includes("--write-notes");
const tags = args.filter((arg) => arg !== "--write-notes");
assert.ok(tags.length <= 1, "usage: check-release.mjs [vX.Y.Z] [--write-notes]");
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const lock = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));
const cargo = await readFile(new URL("Cargo.toml", root), "utf8");
const changelog = await readFile(new URL("CHANGELOG.md", root), "utf8");
const cargoVersion = /^version = "([^"]+)"$/m.exec(cargo)?.[1];
assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const tag = tags[0] ?? `v${pkg.version}`;
assert.equal(tag, `v${pkg.version}`, "release tag must match package version");
assert.equal(pkg.name, "@mobyuz/moby-protocol");
assert.equal(pkg.repository.url, "git+https://github.com/mobyuz/moby-protocol.git");
assert.equal(PROTOCOL_VERSION, pkg.version, "generated protocol constant is stale");
assert.equal(cargoVersion, pkg.version, "Cargo/npm versions differ");
assert.equal(lock.version, pkg.version, "npm lockfile version is stale");
assert.equal(lock.packages[""].version, pkg.version, "npm root lockfile version is stale");
const section = changelog.split(`## [${pkg.version}] - `)[1];
assert.ok(section, "add a versioned CHANGELOG section before releasing");
const [date, ...bodyLines] = section.split(/\r?\n/);
assert.match(date, /^\d{4}-\d{2}-\d{2}$/, "release needs a dated CHANGELOG entry");
const notes = bodyLines.join("\n").split(/^## /m)[0].trim();
assert.ok(notes, "release notes must not be empty");
if (writeNotes) {
  await mkdir(new URL(".release/", root), { recursive: true });
  await writeFile(new URL(".release/notes.md", root), `${notes}\n`);
}
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT,
    `version=${pkg.version}\ntarball=mobyuz-moby-protocol-${pkg.version}.tgz\n`);
}
console.log(`release metadata matches ${tag}`);

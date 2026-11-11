import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertSafeBuildOutput } from "../../scripts/build-output-guard.mjs";

function withTemporaryOutput(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "screen-recorder-build-"));
  try { fn(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test("accepts a fresh isolated build destination", () => {
  withTemporaryOutput(dir => assert.doesNotThrow(() => assertSafeBuildOutput(dir)));
});

test("accepts an ordinary disposable build without an identity key", () => {
  withTemporaryOutput(dir => {
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ manifest_version: 3 }));
    assert.doesNotThrow(() => assertSafeBuildOutput(dir));
  });
});

test("rejects overwriting an installed unpacked extension with identity metadata", () => {
  withTemporaryOutput(dir => {
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ manifest_version: 3, key: "fixture-key" }));
    assert.throws(() => assertSafeBuildOutput(dir), /Refusing to overwrite a Chrome extension build/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).key, "fixture-key");
  });
});

test("fails closed on unreadable existing manifest", () => {
  withTemporaryOutput(dir => {
    fs.writeFileSync(path.join(dir, "manifest.json"), "{invalid");
    assert.throws(() => assertSafeBuildOutput(dir), /unreadable manifest/);
  });
});

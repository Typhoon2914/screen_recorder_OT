import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("schedule configuration: service worker loads enabled schedules from storage", () => {
  const source = read("src/public/service_worker.js");

  assert.match(source, /loadEnabledSchedules/);
  assert.match(source, /schedule_store\.js/);
});

test("schedule configuration: service worker no longer relies on an empty static schedule array", () => {
  const source = read("src/public/service_worker.js");

  assert.doesNotMatch(source, /const\s+AUTOMATION_SCHEDULES\s*=\s*\[\s*\]/);
});

test("schedule configuration: controller receives a dynamic schedules provider", () => {
  const source = read("src/public/service_worker.js");

  assert.match(source, /schedulesProvider\s*:/);
  assert.match(source, /loadEnabledSchedules\(chrome\)/);
});

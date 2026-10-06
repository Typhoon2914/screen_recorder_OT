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

function readJson(rel) {
  return JSON.parse(read(rel));
}

test("chrome integration: manifest grants alarms and storage permissions", () => {
  const manifest = readJson("src/public/manifest.json");

  assert.ok(manifest.permissions.includes("alarms"));
  assert.ok(manifest.permissions.includes("storage"));
});

test("chrome integration: service worker initializes the automation controller", () => {
  const source = read("src/public/service_worker.js");

  assert.match(source, /createChromeAutomationController/);
});

test("chrome integration: service worker creates scheduler alarms on install and startup", () => {
  const source = read("src/public/service_worker.js");

  assert.match(source, /chrome\.runtime\.onInstalled\.addListener/);
  assert.match(source, /chrome\.runtime\.onStartup\.addListener/);
  assert.match(source, /ensurePollingAlarm/);
});

test("chrome integration: service worker forwards Chrome alarm events to the controller", () => {
  const source = read("src/public/service_worker.js");

  assert.match(source, /chrome\.alarms\.onAlarm\.addListener/);
  assert.match(source, /handleAlarm/);
});

test("chrome integration: recorder installs a runtime command listener through the recorder bridge", () => {
  const source = read("src/scripts/recorder.js");

  assert.match(source, /createRecorderBridge/);
  assert.match(source, /chrome\.runtime\.onMessage\.addListener/);
  assert.match(source, /handleCommand/);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTOMATION_POLL_ALARM,
  createChromeAutomationController
} from "../../src/automation/chrome_controller.js";

const recorderUrl = "chrome-extension://example/pages/recorder.html";
const schedule = {
  id: "lecture",
  weekdays: ["Sunday"],
  time: "20:50",
  launchWindowSeconds: 120,
  durationMinutes: 90,
  enabled: true
};
const occurrenceKey = "lecture|2026-10-04|20:50";
const now = {
  date: "2026-10-04",
  weekday: "Sunday",
  time: "20:50:30",
  utcOffsetMinutes: 180
};

function harness() {
  const state = {};
  const sent = [];
  const alarms = [];
  const chromeApi = {
    storage: { local: {
      async get(key) {
        return typeof key === "string"
          ? { [key]: state[key] }
          : state;
      },
      async set(values) { Object.assign(state, values); }
    }},
    tabs: {
      async query() { return [{ id: 15, windowId: 3, url: recorderUrl }]; },
      async update() {},
      async sendMessage(tabId, message) {
        sent.push({ tabId, message });
        return { ok: true };
      }
    },
    windows: { async update() {} },
    alarms: {
      async create(name, data) { alarms.push({ name, data }); }
    }
  };
  function controller(nowMs = Date.parse("2026-10-04T18:00:00Z")) {
    return createChromeAutomationController({
      chromeApi, recorderUrl, schedules: [schedule],
      nowProvider: () => now,
      nowMsProvider: () => nowMs
    });
  }
  return { state, sent, alarms, chromeApi, controller };
}

test("auto-stop integration: dispatch persists enough recording context to associate a started recording with its duration and tab", async () => {
  const h = harness();
  await h.controller().handleAlarm({ name: AUTOMATION_POLL_ALARM });
  const values = JSON.stringify(h.state);
  assert.match(values, /durationMinutes/);
  assert.match(values, /occurrenceKey|lecture\|2026-10-04/);
  assert.match(values, /15/);
});

test("auto-stop integration: RECORDING_STARTED persists a deadline computed from actual start, not schedule time", async () => {
  const h = harness();
  await h.controller().handleAlarm({ name: AUTOMATION_POLL_ALARM });
  await h.controller(Date.parse("2026-10-04T18:15:00Z")).handleRuntimeMessage({
    type: "RECORDING_STARTED", recordingId: "rec-1", occurrenceKey
  }, { tab: { id: 15 } });
  assert.match(JSON.stringify(h.state), /rec-1/);
  assert.match(JSON.stringify(h.state), /stop|deadline|startedAtMs/i);
});

test("auto-stop integration: elapsed deadline delivers exactly one REQUEST_STOP to the matching recorder", async () => {
  const h = harness();
  const startedAt = Date.parse("2026-10-04T18:15:00Z");
  await h.controller().handleAlarm({ name: AUTOMATION_POLL_ALARM });
  await h.controller(startedAt).handleRuntimeMessage({
    type: "RECORDING_STARTED", recordingId: "rec-1", occurrenceKey
  }, { tab: { id: 15 } });
  await h.controller(startedAt + 90 * 60_000).handleAlarm({ name: AUTOMATION_POLL_ALARM });
  await h.controller(startedAt + 90 * 60_000 + 60_000).handleAlarm({ name: AUTOMATION_POLL_ALARM });
  const stops = h.sent.filter((event) => event.message.type === "REQUEST_STOP");
  assert.equal(stops.length, 1);
  assert.equal(stops[0].tabId, 15);
  assert.equal(stops[0].message.reason, "duration_elapsed");
});

test("auto-stop integration: terminal notification cancels deadline so no delayed stop is issued", async () => {
  const h = harness();
  const startedAt = Date.parse("2026-10-04T18:15:00Z");
  await h.controller().handleAlarm({ name: AUTOMATION_POLL_ALARM });
  await h.controller(startedAt).handleRuntimeMessage({
    type: "RECORDING_STARTED", recordingId: "rec-1", occurrenceKey
  }, { tab: { id: 15 } });

  // First prove the controller has actually armed and persisted this recording.
  // Otherwise the no-stop assertion below passes vacuously on an unwired runtime.
  const armedState = JSON.stringify(h.state);
  assert.match(armedState, /rec-1/, "recording must be armed before testing cancellation");
  assert.match(armedState, /stop|deadline|startedAtMs/i,
    "an armed recording must have persisted stop timing state");

  await h.controller().handleRuntimeMessage({
    type: "RECORDING_STOPPED", recordingId: "rec-1"
  }, { tab: { id: 15 } });
  await h.controller(startedAt + 90 * 60_000).handleAlarm({ name: AUTOMATION_POLL_ALARM });
  assert.equal(h.sent.filter((event) => event.message.type === "REQUEST_STOP").length, 0);
});

test("auto-stop integration: persisted deadlines survive rebuilding the controller", async () => {
  const h = harness();
  const startedAt = Date.parse("2026-10-04T18:15:00Z");
  await h.controller().handleAlarm({ name: AUTOMATION_POLL_ALARM });
  await h.controller(startedAt).handleRuntimeMessage({
    type: "RECORDING_STARTED", recordingId: "rec-1", occurrenceKey
  }, { tab: { id: 15 } });
  const freshController = h.controller(startedAt + 90 * 60_000);
  await freshController.handleAlarm({ name: AUTOMATION_POLL_ALARM });
  assert.equal(h.sent.filter((event) => event.message.type === "REQUEST_STOP").length, 1);
});

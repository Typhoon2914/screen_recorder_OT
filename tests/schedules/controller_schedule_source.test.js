import test from "node:test";
import assert from "node:assert/strict";

async function loadController() {
  return import("../../src/automation/chrome_controller.js");
}

const recorderUrl = "chrome-extension://example/pages/recorder.html";
const dueNow = {
  date: "2026-10-04",
  weekday: "Sunday",
  time: "20:50:20"
};

const dueSchedule = {
  id: "dynamic-sunday",
  weekdays: ["Sunday"],
  time: "20:50",
  launchWindowSeconds: 120,
  enabled: true
};

function makeChrome() {
  const calls = {
    storageGets: [],
    storageSets: [],
    messages: []
  };

  return {
    chromeApi: {
      alarms: {
        async create() {}
      },
      tabs: {
        async query() {
          return [{
            id: 10,
            windowId: 2,
            url: recorderUrl
          }];
        },
        async update() {},
        async create() {
          return {
            id: 10,
            windowId: 2,
            url: recorderUrl
          };
        },
        async sendMessage(tabId, message) {
          calls.messages.push({ tabId, message });
          return { ok: true };
        }
      },
      windows: {
        async update() {}
      },
      storage: {
        local: {
          async get(key) {
            calls.storageGets.push(key);
            return {
              automationHandledOccurrenceKeys: []
            };
          },
          async set(value) {
            calls.storageSets.push(value);
          }
        }
      }
    },
    calls
  };
}

test("schedule configuration: controller can obtain schedules from an async provider", async () => {
  const {
    AUTOMATION_POLL_ALARM,
    createChromeAutomationController
  } = await loadController();

  const { chromeApi, calls } = makeChrome();
  let providerCalls = 0;

  const controller = createChromeAutomationController({
    chromeApi,
    recorderUrl,
    schedulesProvider: async () => {
      providerCalls += 1;
      return [dueSchedule];
    },
    nowProvider: () => dueNow
  });

  await controller.handleAlarm({ name: AUTOMATION_POLL_ALARM });

  assert.equal(providerCalls, 1);
  assert.equal(calls.messages.length, 1);
  assert.equal(
    calls.messages[0].message.scheduleId,
    "dynamic-sunday"
  );
});

test("schedule configuration: provider is evaluated on every automation poll", async () => {
  const {
    AUTOMATION_POLL_ALARM,
    createChromeAutomationController
  } = await loadController();

  const { chromeApi, calls } = makeChrome();
  let schedules = [];
  let providerCalls = 0;

  const controller = createChromeAutomationController({
    chromeApi,
    recorderUrl,
    schedulesProvider: async () => {
      providerCalls += 1;
      return schedules;
    },
    nowProvider: () => dueNow
  });

  await controller.handleAlarm({ name: AUTOMATION_POLL_ALARM });
  assert.equal(calls.messages.length, 0);

  schedules = [dueSchedule];

  await controller.handleAlarm({ name: AUTOMATION_POLL_ALARM });

  assert.equal(providerCalls, 2);
  assert.equal(calls.messages.length, 1);
});

test("schedule configuration: unrelated alarms do not query the schedule provider", async () => {
  const { createChromeAutomationController } = await loadController();

  const { chromeApi } = makeChrome();
  let providerCalls = 0;

  const controller = createChromeAutomationController({
    chromeApi,
    recorderUrl,
    schedulesProvider: async () => {
      providerCalls += 1;
      return [dueSchedule];
    },
    nowProvider: () => dueNow
  });

  await controller.handleAlarm({ name: "unrelated-alarm" });

  assert.equal(providerCalls, 0);
});

test("schedule configuration: existing static schedules remain supported", async () => {
  const {
    AUTOMATION_POLL_ALARM,
    createChromeAutomationController
  } = await loadController();

  const { chromeApi, calls } = makeChrome();

  const controller = createChromeAutomationController({
    chromeApi,
    recorderUrl,
    schedules: [dueSchedule],
    nowProvider: () => dueNow
  });

  await controller.handleAlarm({ name: AUTOMATION_POLL_ALARM });

  assert.equal(calls.messages.length, 1);
});

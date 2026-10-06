import test from "node:test";
import assert from "node:assert/strict";

async function loadController() {
  return import("../../src/automation/chrome_controller.js");
}

const recorderUrl = "chrome-extension://example/pages/recorder.html";

const schedule = {
  id: "sunday-image-processing",
  weekdays: ["Sunday"],
  time: "20:50",
  launchWindowSeconds: 120
};

const now = {
  date: "2026-10-04",
  weekday: "Sunday",
  time: "20:50:20",
  utcOffsetMinutes: 180
};

function makeChrome({
  tabs = [],
  handledOccurrenceKeys = [],
  sendMessageError = null
} = {}) {
  const calls = {
    alarmCreates: [],
    tabQueries: [],
    tabUpdates: [],
    windowUpdates: [],
    tabCreates: [],
    tabMessages: [],
    storageGets: [],
    storageSets: []
  };

  const chromeApi = {
    alarms: {
      async create(name, info) {
        calls.alarmCreates.push({ name, info });
      }
    },
    tabs: {
      async query(query) {
        calls.tabQueries.push(query);
        return tabs;
      },
      async update(tabId, update) {
        calls.tabUpdates.push({ tabId, update });
        return { id: tabId, ...update };
      },
      async create(createProperties) {
        calls.tabCreates.push(createProperties);
        return {
          id: 99,
          windowId: 7,
          url: createProperties.url
        };
      },
      async sendMessage(tabId, message) {
        calls.tabMessages.push({ tabId, message });
        if (sendMessageError) throw sendMessageError;
        return { ok: true };
      }
    },
    windows: {
      async update(windowId, update) {
        calls.windowUpdates.push({ windowId, update });
        return { id: windowId, ...update };
      }
    },
    storage: {
      local: {
        async get(key) {
          calls.storageGets.push(key);
          return {
            automationHandledOccurrenceKeys: [...handledOccurrenceKeys]
          };
        },
        async set(value) {
          calls.storageSets.push(value);
        }
      }
    }
  };

  return { chromeApi, calls };
}

test("chrome controller: exposes a stable scheduler alarm name", async () => {
  const { AUTOMATION_POLL_ALARM } = await loadController();

  assert.equal(
    AUTOMATION_POLL_ALARM,
    "screen-recorder-automation-poll"
  );
});

test("chrome controller: creates a one-minute polling alarm", async () => {
  const {
    AUTOMATION_POLL_ALARM,
    createChromeAutomationController
  } = await loadController();

  const { chromeApi, calls } = makeChrome();

  const controller = createChromeAutomationController({
    chromeApi,
    recorderUrl,
    schedules: [schedule],
    nowProvider: () => now
  });

  await controller.ensurePollingAlarm();

  assert.deepEqual(calls.alarmCreates, [
    {
      name: AUTOMATION_POLL_ALARM,
      info: { periodInMinutes: 1 }
    }
  ]);
});

test("chrome controller: ignores unrelated alarms", async () => {
  const { createChromeAutomationController } = await loadController();
  const { chromeApi, calls } = makeChrome();

  const controller = createChromeAutomationController({
    chromeApi,
    recorderUrl,
    schedules: [schedule],
    nowProvider: () => now
  });

  await controller.handleAlarm({ name: "something-else" });

  assert.equal(calls.tabQueries.length, 0);
  assert.equal(calls.tabMessages.length, 0);
});

test("chrome controller: does nothing when no schedule is due", async () => {
  const {
    AUTOMATION_POLL_ALARM,
    createChromeAutomationController
  } = await loadController();

  const { chromeApi, calls } = makeChrome();

  const controller = createChromeAutomationController({
    chromeApi,
    recorderUrl,
    schedules: [schedule],
    nowProvider: () => ({
      ...now,
      time: "20:40:00"
    })
  });

  await controller.handleAlarm({ name: AUTOMATION_POLL_ALARM });

  assert.equal(calls.tabQueries.length, 0);
  assert.equal(calls.tabMessages.length, 0);
  assert.equal(calls.storageSets.length, 0);
});

test("chrome controller: focuses an existing recorder tab and sends REQUEST_RECORDING", async () => {
  const {
    AUTOMATION_POLL_ALARM,
    createChromeAutomationController
  } = await loadController();

  const { chromeApi, calls } = makeChrome({
    tabs: [
      {
        id: 12,
        windowId: 4,
        url: recorderUrl
      }
    ]
  });

  const controller = createChromeAutomationController({
    chromeApi,
    recorderUrl,
    schedules: [schedule],
    nowProvider: () => now
  });

  await controller.handleAlarm({ name: AUTOMATION_POLL_ALARM });

  assert.deepEqual(calls.tabUpdates, [
    { tabId: 12, update: { active: true } }
  ]);
  assert.deepEqual(calls.windowUpdates, [
    { windowId: 4, update: { focused: true } }
  ]);
  assert.deepEqual(calls.tabMessages, [
    {
      tabId: 12,
      message: {
        type: "REQUEST_RECORDING",
        scheduleId: "sunday-image-processing",
        occurrenceKey: "sunday-image-processing|2026-10-04|20:50"
      }
    }
  ]);
});

test("chrome controller: creates the recorder tab when absent and then sends the request", async () => {
  const {
    AUTOMATION_POLL_ALARM,
    createChromeAutomationController
  } = await loadController();

  const { chromeApi, calls } = makeChrome({ tabs: [] });

  const controller = createChromeAutomationController({
    chromeApi,
    recorderUrl,
    schedules: [schedule],
    nowProvider: () => now
  });

  await controller.handleAlarm({ name: AUTOMATION_POLL_ALARM });

  assert.deepEqual(calls.tabCreates, [{ url: recorderUrl }]);
  assert.equal(calls.tabMessages.length, 1);
  assert.equal(calls.tabMessages[0].tabId, 99);
  assert.equal(calls.tabMessages[0].message.type, "REQUEST_RECORDING");
});

test("chrome controller: a handled occurrence is not dispatched twice", async () => {
  const {
    AUTOMATION_POLL_ALARM,
    createChromeAutomationController
  } = await loadController();

  const occurrenceKey =
    "sunday-image-processing|2026-10-04|20:50";

  const { chromeApi, calls } = makeChrome({
    tabs: [{ id: 12, windowId: 4, url: recorderUrl }],
    handledOccurrenceKeys: [occurrenceKey]
  });

  const controller = createChromeAutomationController({
    chromeApi,
    recorderUrl,
    schedules: [schedule],
    nowProvider: () => now
  });

  await controller.handleAlarm({ name: AUTOMATION_POLL_ALARM });

  assert.equal(calls.tabMessages.length, 0);
  assert.equal(calls.storageSets.length, 0);
});

test("chrome controller: successful dispatch persists the handled occurrence", async () => {
  const {
    AUTOMATION_POLL_ALARM,
    createChromeAutomationController
  } = await loadController();

  const { chromeApi, calls } = makeChrome({
    tabs: [{ id: 12, windowId: 4, url: recorderUrl }]
  });

  const controller = createChromeAutomationController({
    chromeApi,
    recorderUrl,
    schedules: [schedule],
    nowProvider: () => now
  });

  await controller.handleAlarm({ name: AUTOMATION_POLL_ALARM });

  assert.deepEqual(calls.storageSets, [
    {
      automationHandledOccurrenceKeys: [
        "sunday-image-processing|2026-10-04|20:50"
      ]
    }
  ]);
});

test("chrome controller: failed recorder delivery does not mark the occurrence handled", async () => {
  const {
    AUTOMATION_POLL_ALARM,
    createChromeAutomationController
  } = await loadController();

  const { chromeApi, calls } = makeChrome({
    tabs: [{ id: 12, windowId: 4, url: recorderUrl }],
    sendMessageError: new Error("receiver unavailable")
  });

  const controller = createChromeAutomationController({
    chromeApi,
    recorderUrl,
    schedules: [schedule],
    nowProvider: () => now
  });

  await assert.rejects(
    () => controller.handleAlarm({ name: AUTOMATION_POLL_ALARM }),
    /receiver unavailable/
  );

  assert.equal(calls.storageSets.length, 0);
});

import test from "node:test";
import assert from "node:assert/strict";

async function loadStore() {
  return import("../../src/automation/schedule_store.js");
}

function makeChrome(initial = {}) {
  let state = structuredClone(initial);
  const calls = { gets: [], sets: [] };

  return {
    chromeApi: {
      storage: {
        local: {
          async get(key) {
            calls.gets.push(key);
            return { [key]: structuredClone(state[key]) };
          },
          async set(value) {
            calls.sets.push(structuredClone(value));
            state = { ...state, ...structuredClone(value) };
          }
        }
      }
    },
    calls,
    getState() {
      return structuredClone(state);
    }
  };
}

const validSchedule = {
  id: "sunday-image-processing",
  weekdays: ["Sunday"],
  time: "20:50",
  launchWindowSeconds: 120,
  enabled: true
};

test("schedule store: exposes a stable storage key", async () => {
  const { AUTOMATION_SCHEDULES_KEY } = await loadStore();

  assert.equal(AUTOMATION_SCHEDULES_KEY, "automationSchedules");
});

test("schedule store: accepts a valid weekly schedule", async () => {
  const { validateScheduleConfig } = await loadStore();

  assert.deepEqual(validateScheduleConfig(validSchedule), validSchedule);
});

test("schedule store: rejects a schedule without a stable id", async () => {
  const { validateScheduleConfig } = await loadStore();

  assert.throws(
    () => validateScheduleConfig({
      ...validSchedule,
      id: ""
    }),
    /id|required|invalid/i
  );
});

test("schedule store: rejects invalid or empty weekdays", async () => {
  const { validateScheduleConfig } = await loadStore();

  assert.throws(
    () => validateScheduleConfig({
      ...validSchedule,
      weekdays: []
    }),
    /weekday|required|invalid/i
  );

  assert.throws(
    () => validateScheduleConfig({
      ...validSchedule,
      weekdays: ["Funday"]
    }),
    /weekday|invalid/i
  );
});

test("schedule store: rejects invalid local HH:mm time", async () => {
  const { validateScheduleConfig } = await loadStore();

  for (const time of ["8:20", "24:00", "20:60", "hello"]) {
    assert.throws(
      () => validateScheduleConfig({
        ...validSchedule,
        time
      }),
      /time|invalid/i
    );
  }
});

test("schedule store: rejects invalid launch windows", async () => {
  const { validateScheduleConfig } = await loadStore();

  for (const launchWindowSeconds of [0, -1, 1.5, "120"]) {
    assert.throws(
      () => validateScheduleConfig({
        ...validSchedule,
        launchWindowSeconds
      }),
      /launch|window|invalid/i
    );
  }
});

test("schedule store: requires an explicit enabled boolean", async () => {
  const { validateScheduleConfig } = await loadStore();

  assert.throws(
    () => validateScheduleConfig({
      ...validSchedule,
      enabled: "yes"
    }),
    /enabled|boolean|invalid/i
  );
});

test("schedule store: rejects duplicate schedule ids", async () => {
  const { validateScheduleList } = await loadStore();

  assert.throws(
    () => validateScheduleList([
      validSchedule,
      { ...validSchedule }
    ]),
    /duplicate|id/i
  );
});

test("schedule store: missing storage returns an empty schedule list", async () => {
  const {
    AUTOMATION_SCHEDULES_KEY,
    loadSchedules
  } = await loadStore();

  const { chromeApi, calls } = makeChrome();

  assert.deepEqual(await loadSchedules(chromeApi), []);
  assert.deepEqual(calls.gets, [AUTOMATION_SCHEDULES_KEY]);
});

test("schedule store: save validates and persists the complete list", async () => {
  const {
    AUTOMATION_SCHEDULES_KEY,
    saveSchedules
  } = await loadStore();

  const { chromeApi, calls, getState } = makeChrome();

  const second = {
    id: "saturday-ai",
    weekdays: ["Saturday"],
    time: "08:20",
    launchWindowSeconds: 90,
    enabled: false
  };

  const saved = await saveSchedules(chromeApi, [
    validSchedule,
    second
  ]);

  assert.deepEqual(saved, [validSchedule, second]);
  assert.deepEqual(calls.sets, [{
    [AUTOMATION_SCHEDULES_KEY]: [validSchedule, second]
  }]);
  assert.deepEqual(
    getState()[AUTOMATION_SCHEDULES_KEY],
    [validSchedule, second]
  );
});

test("schedule store: corrupted stored schedules are rejected instead of silently used", async () => {
  const {
    AUTOMATION_SCHEDULES_KEY,
    loadSchedules
  } = await loadStore();

  const { chromeApi } = makeChrome({
    [AUTOMATION_SCHEDULES_KEY]: [
      {
        ...validSchedule,
        time: "99:99"
      }
    ]
  });

  await assert.rejects(
    () => loadSchedules(chromeApi),
    /time|invalid/i
  );
});

test("schedule store: only enabled schedules are supplied to automation", async () => {
  const {
    AUTOMATION_SCHEDULES_KEY,
    loadEnabledSchedules
  } = await loadStore();

  const disabled = {
    id: "saturday-ai",
    weekdays: ["Saturday"],
    time: "08:20",
    launchWindowSeconds: 90,
    enabled: false
  };

  const { chromeApi } = makeChrome({
    [AUTOMATION_SCHEDULES_KEY]: [
      validSchedule,
      disabled
    ]
  });

  assert.deepEqual(
    await loadEnabledSchedules(chromeApi),
    [validSchedule]
  );
});

test("schedule store: schedule enabled state can be changed and persisted", async () => {
  const {
    AUTOMATION_SCHEDULES_KEY,
    setScheduleEnabled
  } = await loadStore();

  const { chromeApi, getState } = makeChrome({
    [AUTOMATION_SCHEDULES_KEY]: [validSchedule]
  });

  const updated = await setScheduleEnabled(
    chromeApi,
    validSchedule.id,
    false
  );

  assert.equal(updated[0].enabled, false);
  assert.equal(
    getState()[AUTOMATION_SCHEDULES_KEY][0].enabled,
    false
  );
});

test("schedule store: enabling an unknown schedule id is rejected", async () => {
  const {
    AUTOMATION_SCHEDULES_KEY,
    setScheduleEnabled
  } = await loadStore();

  const { chromeApi } = makeChrome({
    [AUTOMATION_SCHEDULES_KEY]: [validSchedule]
  });

  await assert.rejects(
    () => setScheduleEnabled(chromeApi, "missing-id", false),
    /not found|unknown|missing/i
  );
});

import test from "node:test";
import assert from "node:assert/strict";

async function loadScheduler() {
  return import("../../src/automation/scheduler.js");
}

const sunday = {
  id: "sunday-image-processing",
  weekdays: ["Sunday"],
  time: "20:50",
  launchWindowSeconds: 120
};

const saturday = {
  id: "saturday-ai",
  weekdays: ["Saturday"],
  time: "08:20",
  launchWindowSeconds: 120
};

test("scheduler: configured weekly occurrence is due at its local weekday and time", async () => {
  const { isRecordingDue } = await loadScheduler();

  assert.equal(
    isRecordingDue(sunday, {
      date: "2026-10-04",
      weekday: "Sunday",
      time: "20:50:00"
    }),
    true
  );
});

test("scheduler: occurrence is not due before the configured time", async () => {
  const { isRecordingDue } = await loadScheduler();

  assert.equal(
    isRecordingDue(sunday, {
      date: "2026-10-04",
      weekday: "Sunday",
      time: "20:49:59"
    }),
    false
  );
});

test("scheduler: occurrence is not due on another weekday", async () => {
  const { isRecordingDue } = await loadScheduler();

  assert.equal(
    isRecordingDue(sunday, {
      date: "2026-10-05",
      weekday: "Monday",
      time: "20:50:00"
    }),
    false
  );
});

test("scheduler: independent weekly schedules can coexist", async () => {
  const { dueSchedules } = await loadScheduler();

  const due = dueSchedules(
    [saturday, sunday],
    {
      date: "2026-10-04",
      weekday: "Sunday",
      time: "20:50:30"
    }
  );

  assert.deepEqual(due.map((item) => item.id), ["sunday-image-processing"]);
});

test("scheduler: next run selects the nearest future occurrence", async () => {
  const { getNextRun } = await loadScheduler();

  assert.deepEqual(
    getNextRun(
      [saturday, sunday],
      {
        date: "2026-10-02",
        weekday: "Friday",
        time: "18:00:00"
      }
    ),
    {
      scheduleId: "saturday-ai",
      date: "2026-10-03",
      weekday: "Saturday",
      time: "08:20"
    }
  );
});

test("scheduler: after today's time passes, next run moves to the following week", async () => {
  const { getNextRun } = await loadScheduler();

  assert.deepEqual(
    getNextRun(
      [sunday],
      {
        date: "2026-10-04",
        weekday: "Sunday",
        time: "21:00:00"
      }
    ),
    {
      scheduleId: "sunday-image-processing",
      date: "2026-10-11",
      weekday: "Sunday",
      time: "20:50"
    }
  );
});

test("scheduler: explicit local wall-clock values are honored without UTC conversion", async () => {
  const { isRecordingDue } = await loadScheduler();

  const localNow = {
    date: "2026-10-04",
    weekday: "Sunday",
    time: "20:50:20",
    utcOffsetMinutes: 180
  };

  assert.equal(isRecordingDue(sunday, localNow), true);
});

test("scheduler: a handled occurrence cannot trigger twice", async () => {
  const { isRecordingDue, getOccurrenceKey } = await loadScheduler();

  const now = {
    date: "2026-10-04",
    weekday: "Sunday",
    time: "20:50:20"
  };
  const key = getOccurrenceKey(sunday, now);

  assert.equal(
    isRecordingDue(sunday, now, {
      handledOccurrenceKeys: new Set([key])
    }),
    false
  );
});

test("scheduler: polling inside the launch window still identifies the same due occurrence", async () => {
  const { isRecordingDue, getOccurrenceKey } = await loadScheduler();

  const atStart = {
    date: "2026-10-04",
    weekday: "Sunday",
    time: "20:50:00"
  };
  const twentySecondsLater = {
    date: "2026-10-04",
    weekday: "Sunday",
    time: "20:50:20"
  };

  assert.equal(isRecordingDue(sunday, twentySecondsLater), true);
  assert.equal(
    getOccurrenceKey(sunday, atStart),
    getOccurrenceKey(sunday, twentySecondsLater)
  );
});

test("scheduler: a stale occurrence outside its launch window does not trigger", async () => {
  const { isRecordingDue } = await loadScheduler();

  assert.equal(
    isRecordingDue(sunday, {
      date: "2026-10-04",
      weekday: "Sunday",
      time: "21:10:00"
    }),
    false
  );
});

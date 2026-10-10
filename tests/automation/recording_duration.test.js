import test from "node:test";
import assert from "node:assert/strict";

async function loadDuration() {
  return import("../../src/automation/recording_duration.js");
}

const schedule = {
  id: "weekly-lecture",
  weekdays: ["Sunday"],
  time: "20:50",
  launchWindowSeconds: 120,
  enabled: true,
  durationMinutes: 90
};

test("duration: schedule requires positive integer duration", async () => {
  const { validateRecordingDuration } = await loadDuration();
  assert.equal(validateRecordingDuration(90), 90);
  for (const value of [0, -1, 1.5, "90", null, undefined]) {
    assert.throws(() => validateRecordingDuration(value), /duration|minutes|invalid/i);
  }
});

test("duration: deadline is measured from actual MediaRecorder start", async () => {
  const { calculateStopDeadline } = await loadDuration();
  const actualStartMs = Date.parse("2026-10-04T21:03:00Z");
  assert.equal(calculateStopDeadline(actualStartMs, 90), actualStartMs + 90 * 60_000);
});

test("duration: rejects invalid actual start timestamps", async () => {
  const { calculateStopDeadline } = await loadDuration();
  for (const start of [NaN, Infinity, -1, "2026-10-04"]) {
    assert.throws(() => calculateStopDeadline(start, 60), /start|timestamp|invalid/i);
  }
});

test("duration: stop is not due before the deadline", async () => {
  const { isStopDue } = await loadDuration();
  assert.equal(isStopDue(100_000, 99_999), false);
});

test("duration: stop is due at the deadline and after it", async () => {
  const { isStopDue } = await loadDuration();
  assert.equal(isStopDue(100_000, 100_000), true);
  assert.equal(isStopDue(100_000, 101_000), true);
});

test("duration: a schedule retains its configured duration", async () => {
  const { getRecordingDurationMinutes } = await loadDuration();
  assert.equal(getRecordingDurationMinutes(schedule), 90);
});

test("duration: completion of a recording disarms its deadline", async () => {
  const { createRecordingStopCoordinator } = await loadDuration();
  const coordinator = createRecordingStopCoordinator();
  coordinator.arm({ recordingId: "a", startedAtMs: 10_000, durationMinutes: 1 });
  coordinator.complete("a");
  assert.equal(coordinator.poll(80_000), null);
});

test("duration: user stops early without a later duplicate stop", async () => {
  const { createRecordingStopCoordinator } = await loadDuration();
  const coordinator = createRecordingStopCoordinator();
  coordinator.arm({ recordingId: "a", startedAtMs: 10_000, durationMinutes: 1 });
  coordinator.complete("a");
  assert.equal(coordinator.poll(70_000), null);
});

test("duration: unexpected capture ending disarms the stop deadline", async () => {
  const { createRecordingStopCoordinator } = await loadDuration();
  const coordinator = createRecordingStopCoordinator();
  coordinator.arm({ recordingId: "a", startedAtMs: 10_000, durationMinutes: 1 });
  coordinator.complete("a");
  assert.equal(coordinator.poll(70_000), null);
});

test("duration: stop request is emitted once only", async () => {
  const { createRecordingStopCoordinator } = await loadDuration();
  const coordinator = createRecordingStopCoordinator();
  coordinator.arm({ recordingId: "a", startedAtMs: 10_000, durationMinutes: 1 });
  assert.equal(coordinator.poll(69_999), null);
  assert.deepEqual(coordinator.poll(70_000), {
    recordingId: "a",
    reason: "duration_elapsed"
  });
  assert.equal(coordinator.poll(71_000), null);
});

test("duration: rehydrated start data permits stop after a service worker restart", async () => {
  const { createRecordingStopCoordinator } = await loadDuration();
  const coordinator = createRecordingStopCoordinator();
  coordinator.arm({ recordingId: "a", startedAtMs: 10_000, durationMinutes: 1 });
  const persistedState = coordinator.snapshot();
  const restarted = createRecordingStopCoordinator(persistedState);
  assert.deepEqual(restarted.poll(70_000), {
    recordingId: "a",
    reason: "duration_elapsed"
  });
});

test("duration: one active scheduled recording at a time", async () => {
  const { createRecordingStopCoordinator } = await loadDuration();
  const coordinator = createRecordingStopCoordinator();
  coordinator.arm({ recordingId: "a", startedAtMs: 10_000, durationMinutes: 1 });
  assert.throws(
    () => coordinator.arm({ recordingId: "b", startedAtMs: 20_000, durationMinutes: 1 }),
    /active|recording|already/i
  );
});

test("duration: command contract accepts REQUEST_STOP with duration_elapsed", async () => {
  const { parseAutomationCommand } = await import("../../src/automation/commands.js");
  assert.deepEqual(parseAutomationCommand({
    type: "REQUEST_STOP",
    reason: "duration_elapsed"
  }), {
    type: "REQUEST_STOP",
    reason: "duration_elapsed"
  });
});

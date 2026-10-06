import test from "node:test";
import assert from "node:assert/strict";

async function loadCommands() {
  return import("../../src/automation/commands.js");
}

test("automation commands: exposes the required command names", async () => {
  const { AUTOMATION_COMMANDS } = await loadCommands();

  assert.deepEqual(AUTOMATION_COMMANDS, {
    REQUEST_RECORDING: "REQUEST_RECORDING",
    CAPTURE_READY: "CAPTURE_READY",
    RECORDING_STARTED: "RECORDING_STARTED",
    REQUEST_STOP: "REQUEST_STOP",
    RECORDING_STOPPED: "RECORDING_STOPPED",
    AUTOMATION_ERROR: "AUTOMATION_ERROR"
  });
});

test("automation commands: validates a recording request with occurrence identity", async () => {
  const { parseAutomationCommand } = await loadCommands();

  const message = {
    type: "REQUEST_RECORDING",
    scheduleId: "sunday-image-processing",
    occurrenceKey: "sunday-image-processing|2026-10-04|20:50"
  };

  assert.deepEqual(parseAutomationCommand(message), message);
});

test("automation commands: validates capture-ready and recording-started messages", async () => {
  const { parseAutomationCommand } = await loadCommands();

  const captureReady = {
    type: "CAPTURE_READY",
    captureId: "capture-1"
  };
  const recordingStarted = {
    type: "RECORDING_STARTED",
    recordingId: "recording-1"
  };

  assert.deepEqual(parseAutomationCommand(captureReady), captureReady);
  assert.deepEqual(parseAutomationCommand(recordingStarted), recordingStarted);
});

test("automation commands: validates stop and stopped messages", async () => {
  const { parseAutomationCommand } = await loadCommands();

  const stop = {
    type: "REQUEST_STOP",
    reason: "schedule_complete"
  };
  const stopped = {
    type: "RECORDING_STOPPED",
    recordingId: "recording-1"
  };

  assert.deepEqual(parseAutomationCommand(stop), stop);
  assert.deepEqual(parseAutomationCommand(stopped), stopped);
});

test("automation commands: validates structured automation errors", async () => {
  const { parseAutomationCommand } = await loadCommands();

  const error = {
    type: "AUTOMATION_ERROR",
    reason: "capture_cancelled",
    message: "User closed the capture chooser"
  };

  assert.deepEqual(parseAutomationCommand(error), error);
});

test("automation commands: rejects unknown command types", async () => {
  const { parseAutomationCommand } = await loadCommands();

  assert.throws(
    () => parseAutomationCommand({ type: "DO_SOMETHING_UNKNOWN" }),
    /unknown|unsupported|invalid/i
  );
});

test("automation commands: rejects malformed known commands", async () => {
  const { parseAutomationCommand } = await loadCommands();

  assert.throws(
    () => parseAutomationCommand({
      type: "REQUEST_RECORDING",
      scheduleId: "sunday-image-processing"
    }),
    /occurrence|invalid|required/i
  );

  assert.throws(
    () => parseAutomationCommand({
      type: "AUTOMATION_ERROR",
      reason: "capture_failed"
    }),
    /message|invalid|required/i
  );
});

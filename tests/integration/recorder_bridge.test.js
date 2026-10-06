import test from "node:test";
import assert from "node:assert/strict";

async function loadBridge() {
  return import("../../src/automation/recorder_bridge.js");
}

function makeChrome() {
  const sent = [];

  return {
    chromeApi: {
      runtime: {
        async sendMessage(message) {
          sent.push(message);
          return { ok: true };
        }
      }
    },
    sent
  };
}

test("recorder bridge: scheduled recording request asks for capture approval instead of starting capture silently", async () => {
  const { createRecorderBridge } = await loadBridge();

  const captureRequests = [];
  const stops = [];
  const { chromeApi } = makeChrome();

  const bridge = createRecorderBridge({
    chromeApi,
    onCaptureApprovalRequired(request) {
      captureRequests.push(request);
    },
    stopRecording(reason) {
      stops.push(reason);
    }
  });

  const command = {
    type: "REQUEST_RECORDING",
    scheduleId: "sunday-image-processing",
    occurrenceKey: "sunday-image-processing|2026-10-04|20:50"
  };

  await bridge.handleCommand(command);

  assert.deepEqual(captureRequests, [command]);
  assert.deepEqual(stops, []);
});

test("recorder bridge: duplicate REQUEST_RECORDING for the same occurrence is idempotent", async () => {
  const { createRecorderBridge } = await loadBridge();

  const captureRequests = [];
  const { chromeApi } = makeChrome();

  const bridge = createRecorderBridge({
    chromeApi,
    onCaptureApprovalRequired(request) {
      captureRequests.push(request);
    },
    stopRecording() {}
  });

  const command = {
    type: "REQUEST_RECORDING",
    scheduleId: "sunday-image-processing",
    occurrenceKey: "sunday-image-processing|2026-10-04|20:50"
  };

  await bridge.handleCommand(command);
  await bridge.handleCommand(command);

  assert.equal(captureRequests.length, 1);
});

test("recorder bridge: REQUEST_STOP delegates to the existing stop behavior", async () => {
  const { createRecorderBridge } = await loadBridge();

  const stops = [];
  const { chromeApi } = makeChrome();

  const bridge = createRecorderBridge({
    chromeApi,
    onCaptureApprovalRequired() {},
    stopRecording(reason) {
      stops.push(reason);
    }
  });

  await bridge.handleCommand({
    type: "REQUEST_STOP",
    reason: "schedule_complete"
  });

  assert.deepEqual(stops, ["schedule_complete"]);
});

test("recorder bridge: malformed or unknown commands are rejected", async () => {
  const { createRecorderBridge } = await loadBridge();
  const { chromeApi } = makeChrome();

  const bridge = createRecorderBridge({
    chromeApi,
    onCaptureApprovalRequired() {},
    stopRecording() {}
  });

  await assert.rejects(
    () => bridge.handleCommand({ type: "UNKNOWN_COMMAND" }),
    /unknown|unsupported|invalid/i
  );
});

test("recorder bridge: recording start notification is sent to the service worker", async () => {
  const { createRecorderBridge } = await loadBridge();
  const { chromeApi, sent } = makeChrome();

  const bridge = createRecorderBridge({
    chromeApi,
    onCaptureApprovalRequired() {},
    stopRecording() {}
  });

  await bridge.notifyRecordingStarted({
    recordingId: "recording-1",
    occurrenceKey: "sunday-image-processing|2026-10-04|20:50"
  });

  assert.deepEqual(sent, [
    {
      type: "RECORDING_STARTED",
      recordingId: "recording-1",
      occurrenceKey: "sunday-image-processing|2026-10-04|20:50"
    }
  ]);
});

test("recorder bridge: recording stop notification is sent to the service worker", async () => {
  const { createRecorderBridge } = await loadBridge();
  const { chromeApi, sent } = makeChrome();

  const bridge = createRecorderBridge({
    chromeApi,
    onCaptureApprovalRequired() {},
    stopRecording() {}
  });

  await bridge.notifyRecordingStopped({
    recordingId: "recording-1"
  });

  assert.deepEqual(sent, [
    {
      type: "RECORDING_STOPPED",
      recordingId: "recording-1"
    }
  ]);
});

test("recorder bridge: automation errors are sent as structured messages", async () => {
  const { createRecorderBridge } = await loadBridge();
  const { chromeApi, sent } = makeChrome();

  const bridge = createRecorderBridge({
    chromeApi,
    onCaptureApprovalRequired() {},
    stopRecording() {}
  });

  await bridge.notifyAutomationError({
    reason: "capture_cancelled",
    message: "User closed the capture chooser"
  });

  assert.deepEqual(sent, [
    {
      type: "AUTOMATION_ERROR",
      reason: "capture_cancelled",
      message: "User closed the capture chooser"
    }
  ]);
});

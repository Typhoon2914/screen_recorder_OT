import test from "node:test";
import assert from "node:assert/strict";

async function loadStateMachine() {
  return import("../../src/automation/state_machine.js");
}

test("automation state: follows the normal recording lifecycle", async () => {
  const {
    AUTOMATION_STATES,
    AUTOMATION_EVENTS,
    transitionAutomationState
  } = await loadStateMachine();

  let state = { status: AUTOMATION_STATES.IDLE, error: null };

  state = transitionAutomationState(state, {
    type: AUTOMATION_EVENTS.SCHEDULE_DUE
  });
  assert.equal(state.status, AUTOMATION_STATES.DUE);

  state = transitionAutomationState(state, {
    type: AUTOMATION_EVENTS.CAPTURE_REQUESTED
  });
  assert.equal(state.status, AUTOMATION_STATES.AWAITING_CAPTURE_APPROVAL);

  state = transitionAutomationState(state, {
    type: AUTOMATION_EVENTS.RECORDING_STARTED
  });
  assert.equal(state.status, AUTOMATION_STATES.RECORDING);

  state = transitionAutomationState(state, {
    type: AUTOMATION_EVENTS.STOP_REQUESTED
  });
  assert.equal(state.status, AUTOMATION_STATES.STOPPING);

  state = transitionAutomationState(state, {
    type: AUTOMATION_EVENTS.RECORDING_STOPPED
  });
  assert.equal(state.status, AUTOMATION_STATES.COMPLETED);
});

test("automation state: cancelling capture approval records a machine-readable error", async () => {
  const {
    AUTOMATION_STATES,
    AUTOMATION_EVENTS,
    transitionAutomationState
  } = await loadStateMachine();

  const next = transitionAutomationState(
    { status: AUTOMATION_STATES.AWAITING_CAPTURE_APPROVAL, error: null },
    {
      type: AUTOMATION_EVENTS.CAPTURE_CANCELLED,
      reason: "capture_cancelled"
    }
  );

  assert.equal(next.status, AUTOMATION_STATES.ERROR);
  assert.equal(next.error.reason, "capture_cancelled");
});

test("automation state: capture permission failure never claims recording started", async () => {
  const {
    AUTOMATION_STATES,
    AUTOMATION_EVENTS,
    transitionAutomationState
  } = await loadStateMachine();

  const next = transitionAutomationState(
    { status: AUTOMATION_STATES.AWAITING_CAPTURE_APPROVAL, error: null },
    {
      type: AUTOMATION_EVENTS.CAPTURE_FAILED,
      reason: "permission_denied"
    }
  );

  assert.equal(next.status, AUTOMATION_STATES.ERROR);
  assert.notEqual(next.status, AUTOMATION_STATES.RECORDING);
  assert.equal(next.error.reason, "permission_denied");
});

test("automation state: duplicate start request while recording is idempotent", async () => {
  const {
    AUTOMATION_STATES,
    AUTOMATION_EVENTS,
    transitionAutomationState
  } = await loadStateMachine();

  const current = {
    status: AUTOMATION_STATES.RECORDING,
    error: null,
    recordingId: "rec-1"
  };

  const next = transitionAutomationState(current, {
    type: AUTOMATION_EVENTS.RECORDING_STARTED,
    recordingId: "rec-1"
  });

  assert.deepEqual(next, current);
});

test("automation state: stop request while recording moves to stopping", async () => {
  const {
    AUTOMATION_STATES,
    AUTOMATION_EVENTS,
    transitionAutomationState
  } = await loadStateMachine();

  const next = transitionAutomationState(
    { status: AUTOMATION_STATES.RECORDING, error: null },
    { type: AUTOMATION_EVENTS.STOP_REQUESTED, reason: "schedule_complete" }
  );

  assert.equal(next.status, AUTOMATION_STATES.STOPPING);
});

test("automation state: stop request while idle leaves state uncorrupted", async () => {
  const {
    AUTOMATION_STATES,
    AUTOMATION_EVENTS,
    transitionAutomationState
  } = await loadStateMachine();

  const current = { status: AUTOMATION_STATES.IDLE, error: null };
  const next = transitionAutomationState(current, {
    type: AUTOMATION_EVENTS.STOP_REQUESTED,
    reason: "manual"
  });

  assert.deepEqual(next, current);
});

test("automation state: capture stream ending unexpectedly enters stopping", async () => {
  const {
    AUTOMATION_STATES,
    AUTOMATION_EVENTS,
    transitionAutomationState
  } = await loadStateMachine();

  const next = transitionAutomationState(
    { status: AUTOMATION_STATES.RECORDING, error: null },
    { type: AUTOMATION_EVENTS.CAPTURE_ENDED, reason: "stream_ended" }
  );

  assert.equal(next.status, AUTOMATION_STATES.STOPPING);
  assert.equal(next.stopReason, "stream_ended");
});

test("automation state: completed is reachable only after recording stopped", async () => {
  const {
    AUTOMATION_STATES,
    AUTOMATION_EVENTS,
    transitionAutomationState
  } = await loadStateMachine();

  const recording = { status: AUTOMATION_STATES.RECORDING, error: null };
  const invalid = transitionAutomationState(recording, {
    type: AUTOMATION_EVENTS.RECORDING_STOPPED
  });

  assert.notEqual(invalid.status, AUTOMATION_STATES.COMPLETED);

  const stopping = { status: AUTOMATION_STATES.STOPPING, error: null };
  const completed = transitionAutomationState(stopping, {
    type: AUTOMATION_EVENTS.RECORDING_STOPPED
  });

  assert.equal(completed.status, AUTOMATION_STATES.COMPLETED);
});

test("automation state: errors preserve reason and message for diagnostics", async () => {
  const {
    AUTOMATION_STATES,
    AUTOMATION_EVENTS,
    transitionAutomationState
  } = await loadStateMachine();

  const next = transitionAutomationState(
    { status: AUTOMATION_STATES.DUE, error: null },
    {
      type: AUTOMATION_EVENTS.AUTOMATION_FAILED,
      reason: "recorder_unavailable",
      message: "Recorder page could not be opened"
    }
  );

  assert.equal(next.status, AUTOMATION_STATES.ERROR);
  assert.deepEqual(next.error, {
    reason: "recorder_unavailable",
    message: "Recorder page could not be opened"
  });
});

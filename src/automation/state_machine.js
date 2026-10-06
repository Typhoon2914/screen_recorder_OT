export const AUTOMATION_STATES = Object.freeze({
  IDLE: "IDLE",
  DUE: "DUE",
  AWAITING_CAPTURE_APPROVAL: "AWAITING_CAPTURE_APPROVAL",
  RECORDING: "RECORDING",
  STOPPING: "STOPPING",
  COMPLETED: "COMPLETED",
  ERROR: "ERROR"
});

export const AUTOMATION_EVENTS = Object.freeze({
  SCHEDULE_DUE: "SCHEDULE_DUE",
  CAPTURE_REQUESTED: "CAPTURE_REQUESTED",
  RECORDING_STARTED: "RECORDING_STARTED",
  STOP_REQUESTED: "STOP_REQUESTED",
  RECORDING_STOPPED: "RECORDING_STOPPED",
  CAPTURE_CANCELLED: "CAPTURE_CANCELLED",
  CAPTURE_FAILED: "CAPTURE_FAILED",
  CAPTURE_ENDED: "CAPTURE_ENDED",
  AUTOMATION_FAILED: "AUTOMATION_FAILED"
});

function toError(event, fallbackReason) {
  const error = {
    reason: event.reason || fallbackReason
  };

  if (event.message) error.message = event.message;
  return error;
}

export function transitionAutomationState(state, event) {
  if (!state || !event?.type) return state;

  const { status } = state;

  if (
    status === AUTOMATION_STATES.RECORDING &&
    event.type === AUTOMATION_EVENTS.RECORDING_STARTED
  ) {
    return state;
  }

  if (
    status === AUTOMATION_STATES.IDLE &&
    event.type === AUTOMATION_EVENTS.SCHEDULE_DUE
  ) {
    return { ...state, status: AUTOMATION_STATES.DUE, error: null };
  }

  if (
    status === AUTOMATION_STATES.DUE &&
    event.type === AUTOMATION_EVENTS.CAPTURE_REQUESTED
  ) {
    return {
      ...state,
      status: AUTOMATION_STATES.AWAITING_CAPTURE_APPROVAL,
      error: null
    };
  }

  if (
    status === AUTOMATION_STATES.AWAITING_CAPTURE_APPROVAL &&
    event.type === AUTOMATION_EVENTS.RECORDING_STARTED
  ) {
    return {
      ...state,
      status: AUTOMATION_STATES.RECORDING,
      error: null,
      ...(event.recordingId ? { recordingId: event.recordingId } : {})
    };
  }

  if (
    status === AUTOMATION_STATES.RECORDING &&
    event.type === AUTOMATION_EVENTS.STOP_REQUESTED
  ) {
    return {
      ...state,
      status: AUTOMATION_STATES.STOPPING,
      ...(event.reason ? { stopReason: event.reason } : {})
    };
  }

  if (
    status === AUTOMATION_STATES.RECORDING &&
    event.type === AUTOMATION_EVENTS.CAPTURE_ENDED
  ) {
    return {
      ...state,
      status: AUTOMATION_STATES.STOPPING,
      stopReason: event.reason || "capture_ended"
    };
  }

  if (
    status === AUTOMATION_STATES.STOPPING &&
    event.type === AUTOMATION_EVENTS.RECORDING_STOPPED
  ) {
    return {
      ...state,
      status: AUTOMATION_STATES.COMPLETED,
      error: null
    };
  }

  if (
    status === AUTOMATION_STATES.AWAITING_CAPTURE_APPROVAL &&
    event.type === AUTOMATION_EVENTS.CAPTURE_CANCELLED
  ) {
    return {
      ...state,
      status: AUTOMATION_STATES.ERROR,
      error: toError(event, "capture_cancelled")
    };
  }

  if (
    status === AUTOMATION_STATES.AWAITING_CAPTURE_APPROVAL &&
    event.type === AUTOMATION_EVENTS.CAPTURE_FAILED
  ) {
    return {
      ...state,
      status: AUTOMATION_STATES.ERROR,
      error: toError(event, "capture_failed")
    };
  }

  if (event.type === AUTOMATION_EVENTS.AUTOMATION_FAILED) {
    return {
      ...state,
      status: AUTOMATION_STATES.ERROR,
      error: toError(event, "automation_failed")
    };
  }

  return state;
}

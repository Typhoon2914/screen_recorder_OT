export function validateRecordingDuration(durationMinutes) {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error("Invalid recording durationMinutes: expected a positive integer.");
  }
  return durationMinutes;
}

function validateStart(startedAtMs) {
  if (!Number.isFinite(startedAtMs) || startedAtMs < 0) {
    throw new Error("Invalid recording start timestamp.");
  }
}

export function calculateStopDeadline(startedAtMs, durationMinutes) {
  validateStart(startedAtMs);
  validateRecordingDuration(durationMinutes);
  const deadline = startedAtMs + durationMinutes * 60_000;
  if (!Number.isSafeInteger(deadline)) {
    throw new Error("Invalid recording stop deadline.");
  }
  return deadline;
}

export function isStopDue(deadlineMs, nowMs) {
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs)) {
    throw new Error("Invalid stop deadline or current timestamp.");
  }
  return nowMs >= deadlineMs;
}

export function getRecordingDurationMinutes(schedule) {
  return validateRecordingDuration(schedule?.durationMinutes);
}

function validateSnapshot(snapshot) {
  if (snapshot == null) return null;
  if (typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Invalid persisted recording stop state.");
  }
  if (typeof snapshot.recordingId !== "string" || !snapshot.recordingId.trim()) {
    throw new Error("Invalid persisted recording id.");
  }
  validateStart(snapshot.startedAtMs);
  validateRecordingDuration(snapshot.durationMinutes);
  if (typeof snapshot.stopRequested !== "boolean") {
    throw new Error("Invalid persisted stopRequested flag.");
  }
  calculateStopDeadline(snapshot.startedAtMs, snapshot.durationMinutes);
  return { ...snapshot };
}

export function createRecordingStopCoordinator(initialSnapshot = null) {
  let active = validateSnapshot(initialSnapshot);

  function arm({ recordingId, startedAtMs, durationMinutes }) {
    if (active) throw new Error("An active recording is already armed.");
    if (typeof recordingId !== "string" || !recordingId.trim()) {
      throw new Error("Invalid recording id.");
    }
    calculateStopDeadline(startedAtMs, durationMinutes);
    active = { recordingId, startedAtMs, durationMinutes, stopRequested: false };
    return snapshot();
  }

  function complete(recordingId) {
    if (active?.recordingId === recordingId) {
      active = null;
      return true;
    }
    return false;
  }

  function poll(nowMs) {
    if (!active || active.stopRequested) return null;
    const deadline = calculateStopDeadline(active.startedAtMs, active.durationMinutes);
    if (!isStopDue(deadline, nowMs)) return null;
    active.stopRequested = true;
    return { recordingId: active.recordingId, reason: "duration_elapsed" };
  }

  function snapshot() {
    return active ? { ...active } : null;
  }

  return { arm, complete, poll, snapshot };
}

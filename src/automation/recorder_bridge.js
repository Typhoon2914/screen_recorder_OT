import {
  AUTOMATION_COMMANDS,
  parseAutomationCommand
} from "./commands.js";

export function createRecorderBridge({
  chromeApi,
  onCaptureApprovalRequired,
  stopRecording
}) {
  if (!chromeApi) throw new Error("chromeApi is required.");
  if (typeof onCaptureApprovalRequired !== "function") {
    throw new Error("onCaptureApprovalRequired is required.");
  }
  if (typeof stopRecording !== "function") {
    throw new Error("stopRecording is required.");
  }

  let pendingOccurrenceKey = null;

  async function handleCommand(rawCommand) {
    const command = parseAutomationCommand(rawCommand);

    switch (command.type) {
      case AUTOMATION_COMMANDS.REQUEST_RECORDING:
        if (pendingOccurrenceKey === command.occurrenceKey) {
          return { ok: true, duplicate: true };
        }

        pendingOccurrenceKey = command.occurrenceKey;
        await onCaptureApprovalRequired(command);
        return { ok: true, awaitingCaptureApproval: true };

      case AUTOMATION_COMMANDS.REQUEST_STOP:
        await stopRecording(command.reason);
        return { ok: true };

      default:
        return { ok: false, ignored: true };
    }
  }

  async function notifyRecordingStarted({
    recordingId,
    occurrenceKey
  }) {
    const message = parseAutomationCommand({
      type: AUTOMATION_COMMANDS.RECORDING_STARTED,
      recordingId,
      occurrenceKey
    });

    return chromeApi.runtime.sendMessage(message);
  }

  async function notifyRecordingStopped({ recordingId }) {
    const message = parseAutomationCommand({
      type: AUTOMATION_COMMANDS.RECORDING_STOPPED,
      recordingId
    });

    return chromeApi.runtime.sendMessage(message);
  }

  async function notifyAutomationError({ reason, message }) {
    const command = parseAutomationCommand({
      type: AUTOMATION_COMMANDS.AUTOMATION_ERROR,
      reason,
      message
    });

    return chromeApi.runtime.sendMessage(command);
  }

  function clearPendingOccurrence(occurrenceKey) {
    if (!occurrenceKey || pendingOccurrenceKey === occurrenceKey) {
      pendingOccurrenceKey = null;
    }
  }

  return {
    handleCommand,
    notifyRecordingStarted,
    notifyRecordingStopped,
    notifyAutomationError,
    clearPendingOccurrence
  };
}

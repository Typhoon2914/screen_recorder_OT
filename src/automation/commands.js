export const AUTOMATION_COMMANDS = Object.freeze({
  REQUEST_RECORDING: "REQUEST_RECORDING",
  CAPTURE_READY: "CAPTURE_READY",
  RECORDING_STARTED: "RECORDING_STARTED",
  REQUEST_STOP: "REQUEST_STOP",
  RECORDING_STOPPED: "RECORDING_STOPPED",
  AUTOMATION_ERROR: "AUTOMATION_ERROR"
});

function requireString(command, field) {
  if (typeof command[field] !== "string" || command[field].trim() === "") {
    throw new Error(`Invalid ${command.type}: ${field} is required.`);
  }
}

export function parseAutomationCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw new Error("Invalid automation command.");
  }

  if (!Object.values(AUTOMATION_COMMANDS).includes(command.type)) {
    throw new Error(`Unknown automation command type: ${command.type}`);
  }

  switch (command.type) {
    case AUTOMATION_COMMANDS.REQUEST_RECORDING:
      requireString(command, "scheduleId");
      requireString(command, "occurrenceKey");
      break;

    case AUTOMATION_COMMANDS.CAPTURE_READY:
      requireString(command, "captureId");
      break;

    case AUTOMATION_COMMANDS.RECORDING_STARTED:
      requireString(command, "recordingId");
      break;

    case AUTOMATION_COMMANDS.REQUEST_STOP:
      requireString(command, "reason");
      break;

    case AUTOMATION_COMMANDS.RECORDING_STOPPED:
      requireString(command, "recordingId");
      break;

    case AUTOMATION_COMMANDS.AUTOMATION_ERROR:
      requireString(command, "reason");
      requireString(command, "message");
      break;
  }

  return command;
}

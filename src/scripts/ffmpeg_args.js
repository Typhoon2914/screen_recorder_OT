export function buildFaststartRemuxArgs(inputName, outputName) {
  if (!inputName || !outputName) {
    throw new Error("Input and output file names are required.");
  }

  return [
    "-i", inputName,
    "-c", "copy",
    "-movflags", "+faststart",
    outputName
  ];
}

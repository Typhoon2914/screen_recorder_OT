import test from "node:test";
import assert from "node:assert/strict";

import { buildFaststartRemuxArgs } from "../src/scripts/ffmpeg_args.js";

test("buildFaststartRemuxArgs copies streams and enables MP4 faststart", () => {
  assert.deepEqual(
    buildFaststartRemuxArgs("in.mp4", "out.mp4"),
    [
      "-i", "in.mp4",
      "-c", "copy",
      "-movflags", "+faststart",
      "out.mp4"
    ]
  );
});

test("buildFaststartRemuxArgs uses the supplied input and output names", () => {
  const args = buildFaststartRemuxArgs("lecture.mp4", "fixed.mp4");

  assert.equal(args[1], "lecture.mp4");
  assert.equal(args.at(-1), "fixed.mp4");
});

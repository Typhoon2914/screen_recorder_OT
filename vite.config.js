import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

function copyFFmpegCore() {
  return {
    name: "copy-ffmpeg-core",
    closeBundle() {
      const esmDir = path.resolve("node_modules/@ffmpeg/core/dist/esm");
      if (!fs.existsSync(esmDir)) {
        throw new Error("Missing @ffmpeg/core/dist/esm");
      }

      const out = path.resolve("dist/ffmpeg");
      fs.mkdirSync(out, { recursive: true });

      const must = ["ffmpeg-core.js", "ffmpeg-core.wasm"];
      for (const f of must) {
        const src = path.join(esmDir, f);
        if (!fs.existsSync(src)) throw new Error(`Missing ${src}`);
        fs.copyFileSync(src, path.join(out, f));
        console.log("✅ copied", f, "from", src);
      }

      // Optional (often absent)
      const worker = path.join(esmDir, "ffmpeg-core.worker.js");
      if (fs.existsSync(worker)) {
        fs.copyFileSync(worker, path.join(out, "ffmpeg-core.worker.js"));
        console.log("✅ copied ffmpeg-core.worker.js");
      }
    }
  };
}

function copyAutomationModules() {
  return {
    name: "copy-automation-modules",
    closeBundle() {
      const src = path.resolve("src/automation");
      const out = path.resolve("dist/automation");

      if (!fs.existsSync(src)) {
        throw new Error("Missing src/automation");
      }

      fs.cpSync(src, out, { recursive: true });
      console.log("✅ copied automation modules");
    }
  };
}

export default defineConfig({
  root: "src",
  publicDir: "public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        recorder: path.resolve(__dirname, "src/pages/recorder.html")
      }
    }
  },
  plugins: [
    copyFFmpegCore(),
    copyAutomationModules()
  ]
});

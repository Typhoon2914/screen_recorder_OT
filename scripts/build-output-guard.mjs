import fs from "node:fs";
import path from "node:path";

/**
 * Refuse to overwrite an unpacked Chrome extension directory that contains an
 * identity-preserving manifest key. Chrome uses that key to retain an extension
 * identity across unpacked builds; losing it can strand local storage/settings.
 *
 * Build experiments into a separate --outDir instead of rebuilding over the
 * installed extension. Deliberate deployment is a separate, manual operation.
 */
export function assertSafeBuildOutput(outputDir) {
  const manifestPath = path.join(path.resolve(outputDir), "manifest.json");
  if (!fs.existsSync(manifestPath)) return;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error(
      `Refusing to replace an existing output with an unreadable manifest: ${manifestPath}. ` +
      "Build to a separate --outDir and inspect that directory before deployment."
    );
  }
  if (typeof manifest.key === "string" && manifest.key.trim()) {
    throw new Error(
      `Refusing to overwrite a Chrome extension build with identity metadata: ${path.dirname(manifestPath)}. ` +
      "This may be the installed extension. Build to a separate --outDir; never delete " +
      "the manifest key or rebuild over an active installation."
    );
  }
}

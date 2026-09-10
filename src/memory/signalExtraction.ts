/**
 * Real signal extraction — Day 6. §8.1 step 2 ("extract build signals")
 * against the ACTUAL uploaded build, not the hand-authored signals Day 4-5's
 * tests used. Deliberately dumb: read every non-binary file in the
 * extracted deploy folder, classify it, hand the raw text to the existing
 * two-stage match (prefilter + reasoning). No secret-detection heuristics
 * live here — that judgement belongs to the §8.2 pipeline already built;
 * this module's only job is turning bytes on disk into `BuildSignal[]`.
 */
import fs from "node:fs";
import path from "node:path";
import type { BuildSignal } from "./patternMatch.ts";

const MAX_TEXT_CHARS = 50_000; // cap per file so one huge asset can't blow the LLM context
const MAX_SIGNAL_FILES = 300; // a static build is a few dozen files; anything past this is a mis-upload
const MAX_TOTAL_SIGNAL_CHARS = 3_000_000; // ~3 MB of text — bounds the LLM context AND the Sibyl scan/active payload
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".avif",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".gz", ".tar", ".pdf", ".mp4", ".mp3", ".wasm",
  ".pack", ".idx", ".node", ".dll", ".so", ".dylib", ".exe", ".bin", ".class",
]);
// Directories that are never "build output" — a static deploy shouldn't
// contain these, but people zip a whole project checkout by mistake. Walking
// node_modules / .git also drags binary blobs and mixed encodings into the
// Sibyl bridge (see sibylBridge.ts — that was a real incident, 2026-09-09).
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache",
  ".venv", "venv", "__pycache__", ".pytest_cache", "vendor", ".gradle", ".idea", ".vscode",
]);

function classifyArtifactKind(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase();
  const lower = relPath.toLowerCase();
  if (ext === ".log" || lower.includes("log")) return "build-log";
  if (
    [".js", ".mjs", ".cjs", ".css", ".html", ".htm", ".map", ".json"].includes(ext) ||
    lower.includes("dist/") ||
    lower.includes("bundle")
  ) {
    return "bundle";
  }
  return "source";
}

/** Cheap binary sniff: a NUL byte or a high density of non-text control bytes
 *  in the first 8KB means "don't feed this to the text pipeline". */
function looksBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192);
  let suspicious = 0;
  for (let i = 0; i < len; i++) {
    const b = buf[i];
    if (b === 0) return true;
    // control chars outside \t \n \r \f, and the C1 range 0x80-0x9F that
    // isn't valid as a lone byte in UTF-8 text
    if ((b < 0x09 || (b > 0x0d && b < 0x20)) || (b >= 0x80 && b <= 0x9f)) suspicious++;
  }
  return len > 0 && suspicious / len > 0.02;
}

/** Node's `Buffer.toString("utf8")` can leave lone surrogates (split pair at
 *  the slice boundary; certain invalid sequences). Anything downstream that
 *  JSON-round-trips through another runtime chokes on those — scrub them. */
function toWellFormedText(buf: Buffer): string {
  const s = buf.toString("utf8").slice(0, MAX_TEXT_CHARS);
  // Node ≥20 has String.prototype.toWellFormed; fall back to a manual scrub.
  const anyStr = s as unknown as { toWellFormed?: () => string };
  return typeof anyStr.toWellFormed === "function"
    ? anyStr.toWellFormed()
    : s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");
}

/** Walk `srcDir` and return one BuildSignal per readable text file, skipping
 *  project cruft (node_modules, .git, …) and bounding the total payload. */
export function extractBuildSignals(srcDir: string): BuildSignal[] {
  const signals: BuildSignal[] = [];
  let totalChars = 0;

  const walk = (abs: string, rel: string) => {
    if (signals.length >= MAX_SIGNAL_FILES || totalChars >= MAX_TOTAL_SIGNAL_CHARS) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (signals.length >= MAX_SIGNAL_FILES || totalChars >= MAX_TOTAL_SIGNAL_CHARS) return;
      const abs2 = path.join(abs, entry.name);
      const rel2 = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(abs2, rel2);
        continue;
      }
      if (!entry.isFile()) continue;
      if (BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

      let buf: Buffer;
      try {
        buf = fs.readFileSync(abs2);
      } catch {
        continue;
      }
      if (buf.length === 0 || looksBinary(buf)) continue;

      const text = toWellFormedText(buf);
      totalChars += text.length;
      signals.push({ artifact_kind: classifyArtifactKind(rel2), text: `[${rel2}]\n${text}`, path: rel2 });
    }
  };

  walk(srcDir, "");
  return signals;
}

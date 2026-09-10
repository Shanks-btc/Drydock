"use client";

// Client-side zip of a picked folder (or pass-through of an already-zipped
// upload). The backend (`POST /deploy`) wants `application/zip` bytes and
// extracts them itself — so /try-it zips in the browser and never uploads
// loose files.
//
// Progress: reading the folder is a real per-file loop, so that stage is
// determinate ("18 / 24 files"). The compression itself is fflate's one-shot
// async `zip()` (one Web Worker, off the main thread) which exposes no
// per-chunk callback — that stage is reported indeterminate ("Compressing
// N files…"). The loop yields to the event loop periodically so the count
// actually animates instead of jumping at the end.

import { zip as fflateZip } from "fflate";

const MAX_FILES = 400;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // backend cap is 50mb; stay well under

const log = (...a: unknown[]) => console.info("%c[drydock/try-it]", "color:#2DD4BF", ...a);

export interface PreparedUpload {
  blob: Blob;
  fileCount: number;
  totalBytes: number;
  /** Display paths, relative, for the "N files" confirmation. */
  paths: string[];
  /** True when the user handed us a .zip and we passed it straight through. */
  passthrough: boolean;
}

export type PrepProgress =
  | { phase: "reading"; done: number; total: number; bytes: number }
  | { phase: "compressing"; files: number; bytes: number };

export type PrepProgressFn = (p: PrepProgress) => void;

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

function relPath(file: File): string {
  // <input webkitdirectory> sets webkitRelativePath ("site/index.html");
  // drag-drop entries we normalise to the same shape before calling in.
  const p = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  // Drop the leading top-level directory segment so the zip root is the
  // site root (matches how the CLI test harness zips a folder's contents).
  const parts = p.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : p;
}

const nextTick = () => new Promise<void>((r) => setTimeout(r, 0));

/** A single dropped/picked `.zip` — use its bytes directly. */
export async function prepareZipFile(file: File, onProgress?: PrepProgressFn): Promise<PreparedUpload> {
  onProgress?.({ phase: "reading", done: 0, total: 1, bytes: 0 });
  const buf = await file.arrayBuffer();
  if (buf.byteLength === 0) throw new ZipError("That .zip file is empty.");
  if (buf.byteLength > MAX_TOTAL_BYTES) {
    throw new ZipError(`That .zip is ${(buf.byteLength / 1e6).toFixed(1)} MB — keep it under 25 MB.`);
  }
  onProgress?.({ phase: "reading", done: 1, total: 1, bytes: buf.byteLength });
  return {
    blob: new Blob([buf], { type: "application/zip" }),
    fileCount: 1,
    totalBytes: buf.byteLength,
    paths: [file.name],
    passthrough: true,
  };
}

/** A picked folder (many File objects with webkitRelativePath). Zip them. */
export async function prepareFolder(files: File[], onProgress?: PrepProgressFn): Promise<PreparedUpload> {
  // Drop only empty dotfiles (.DS_Store etc.); keep everything else.
  const real = files.filter((f) => f.size > 0 || !f.name.startsWith("."));
  log(`prepareFolder — ${files.length} picked, ${real.length} after filtering junk`);
  if (real.length === 0) throw new ZipError("That folder has no usable files in it.");
  if (real.length > MAX_FILES) {
    throw new ZipError(
      `That folder has ${real.length} files — /try-it accepts up to ${MAX_FILES}. Point it at just the built output (e.g. dist/ or build/), not the whole project.`,
    );
  }

  onProgress?.({ phase: "reading", done: 0, total: real.length, bytes: 0 });

  const entries: Record<string, Uint8Array> = {};
  let totalBytes = 0;
  const paths: string[] = [];
  // Yield ~40 times total no matter the file count, so the counter animates
  // without adding meaningful overhead on a large folder.
  const yieldEvery = Math.max(1, Math.ceil(real.length / 40));

  for (let i = 0; i < real.length; i++) {
    const file = real[i];
    const path = relPath(file);
    if (path && !path.endsWith("/")) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new ZipError("That folder is over 25 MB once combined — trim it down and retry.");
      }
      entries[path] = bytes;
      paths.push(path);
    }
    onProgress?.({ phase: "reading", done: i + 1, total: real.length, bytes: totalBytes });
    if ((i + 1) % yieldEvery === 0) await nextTick();
  }
  if (paths.length === 0) throw new ZipError("Couldn't read any files from that folder.");

  log(`read ${paths.length} files (${(totalBytes / 1048576).toFixed(2)} MB) — compressing…`);
  onProgress?.({ phase: "compressing", files: paths.length, bytes: totalBytes });
  await nextTick(); // let the "Compressing" state paint before the worker spins up

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    // fflate's async zip() runs in an inline Web Worker. If that Worker can't
    // be created (blocked, weird environment) the callback would never fire —
    // a timeout turns that into a clear error instead of a stuck spinner.
    const guard = setTimeout(
      () => reject(new ZipError("Compression stalled — the browser may have blocked the zip Web Worker. Try the .zip upload instead.")),
      45_000,
    );
    fflateZip(entries, { level: 6 }, (err, data) => {
      clearTimeout(guard);
      if (err) reject(new ZipError(err.message));
      else resolve(data);
    });
  });
  log(`compressed to ${(zipped.byteLength / 1048576).toFixed(2)} MB`);

  return {
    blob: new Blob([zipped], { type: "application/zip" }),
    fileCount: paths.length,
    totalBytes,
    paths: paths.sort(),
    passthrough: false,
  };
}

/** Route a FileList from either an `<input webkitdirectory>` or a single
 *  `.zip` pick to the right preparer. */
export async function prepareUpload(files: File[], onProgress?: PrepProgressFn): Promise<PreparedUpload> {
  if (files.length === 0) throw new ZipError("Nothing selected.");
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    return prepareZipFile(files[0], onProgress);
  }
  return prepareFolder(files, onProgress);
}

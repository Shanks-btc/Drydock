// Generate a realistic-sized static-site folder for testing /try-it's
// client-side zip + upload progress. Not a toy: ~150 files, ~7 MB, a mix of
// compressible text (HTML/CSS/JS) and near-incompressible assets (so fflate
// actually has work to do). Stays under the /try-it caps (400 files, 25 MB).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** @returns {{ dir: string, fileCount: number, totalBytes: number }} */
export function makeSampleSite(destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(destDir, "assets"), { recursive: true });
  fs.mkdirSync(path.join(destDir, "chunks"), { recursive: true });

  let totalBytes = 0;
  let fileCount = 0;
  const write = (rel, buf) => {
    const abs = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    totalBytes += buf.length;
    fileCount += 1;
  };

  write(
    "index.html",
    Buffer.from(
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width, initial-scale=1">` +
        `<title>Big sample site</title><link rel="stylesheet" href="style.css">` +
        `</head><body><main><h1 class="marker" data-drydock-marker="big-sample-v1">Big sample site</h1>` +
        `<p>${"Lorem ipsum dolor sit amet. ".repeat(400)}</p></main>` +
        `<script src="chunks/entry.js"></script></body></html>\n`,
    ),
  );
  write("style.css", Buffer.from(`body{margin:0;font:16px/1.6 system-ui}\n${".x{color:#14b8a6}\n".repeat(2000)}`));

  // ~90 JS "chunks" — compressible text, ~30 KB each (~2.7 MB, ~3:1 zip).
  for (let i = 0; i < 90; i++) {
    const body =
      `// chunk ${i}\nexport const c${i} = ${JSON.stringify(
        Array.from({ length: 60 }, (_, k) => `item-${i}-${k}-${"data".repeat(30)}`),
      )};\n`.repeat(6);
    write(`chunks/chunk-${String(i).padStart(3, "0")}.js`, Buffer.from(body));
  }
  write("chunks/entry.js", Buffer.from(`import "./chunk-000.js";\nconsole.log("entry");\n`));

  // ~55 binary "assets" — crypto-random, ~80 KB each (~4.4 MB, ~incompressible).
  for (let i = 0; i < 55; i++) {
    write(`assets/asset-${String(i).padStart(3, "0")}.bin`, crypto.randomBytes(80 * 1024));
  }

  return { dir: destDir, fileCount, totalBytes };
}

/** A small, valid static folder that has NO index.html at its root — a
 *  built app whose entry point is `app.html`, say. For the pre-upload
 *  "no index.html" warning path. */
export function makeNoIndexSite(destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(destDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(destDir, "app.html"), `<!doctype html><title>App</title><h1 data-drydock-marker="no-index-v1">App entry (not index.html)</h1>\n`);
  fs.writeFileSync(path.join(destDir, "style.css"), "body{font:16px system-ui}\n");
  fs.writeFileSync(path.join(destDir, "assets", "app.js"), "console.log('app');\n");
  fs.writeFileSync(path.join(destDir, "README.md"), "# not a static site root\n");
  return { dir: destDir, fileCount: 4 };
}

/** A folder that trips the >400-file cap in zipFolder.ts (for the zip-error path). */
export function makeTooManyFiles(destDir, count = 420) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(path.join(destDir, `f${String(i).padStart(4, "0")}.txt`), `file ${i}\n`);
  }
  return { dir: destDir, fileCount: count };
}

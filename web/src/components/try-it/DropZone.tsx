"use client";

import { useCallback, useRef, useState } from "react";

// Folder / zip picker for /try-it. Drag-drop a folder or a .zip, or use the
// buttons. Two presets are the real backend test fixtures (sample-site,
// leaked-key-site) served as zips from /public/presets — the leaked-key one
// is a genuine known incident the memory gate will flag.

const log = (...a: unknown[]) => console.info("%c[drydock/try-it]", "color:#2DD4BF", ...a);

async function readEntry(entry: FileSystemEntry, prefix: string): Promise<File[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    // Re-wrap so webkitRelativePath carries the folder path (drop events lose it).
    const withPath = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
    Object.defineProperty(withPath, "webkitRelativePath", { value: `${prefix}${file.name}` });
    return [withPath];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const entries: FileSystemEntry[] = await new Promise((res, rej) => {
    const acc: FileSystemEntry[] = [];
    const pump = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return res(acc);
        acc.push(...batch);
        pump();
      }, rej);
    pump();
  });
  const nested = await Promise.all(entries.map((e) => readEntry(e, `${prefix}${entry.name}/`)));
  return nested.flat();
}

export default function DropZone({
  onSelect,
  disabled = false,
  error,
}: {
  onSelect: (files: File[]) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const [dragging, setDragging] = useState(false);
  const [loadingPreset, setLoadingPreset] = useState<string | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const items = Array.from(e.dataTransfer.items).filter((i) => i.kind === "file");
      const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
      if (entries.length) {
        const files = (await Promise.all(entries.map((en) => readEntry(en, "")))).flat();
        if (files.length) onSelect(files);
        return;
      }
      const plain = Array.from(e.dataTransfer.files);
      if (plain.length) onSelect(plain);
    },
    [disabled, onSelect],
  );

  const loadPreset = useCallback(
    async (key: "clean" | "leaked-key", label: string) => {
      if (disabled) return;
      setLoadingPreset(key);
      try {
        const res = await fetch(`/presets/${key}.zip`);
        const buf = await res.arrayBuffer();
        const file = new File([buf], `${key}.zip`, { type: "application/zip" });
        onSelect([file]);
      } catch {
        /* onSelect not called — the parent stays on the picker */
      } finally {
        setLoadingPreset(null);
      }
    },
    [disabled, onSelect],
  );

  return (
    <div className="w-full min-w-0">
      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-[#FF7A7A]/40 bg-[#FF7A7A]/[0.09] p-3.5">
          <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 fill-[#FF7A7A]">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.9 3.6h1.8v5H7.1v-5ZM8 12.4a1.05 1.05 0 1 1 0-2.1 1.05 1.05 0 0 1 0 2.1Z" />
          </svg>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[#FF7A7A]">Couldn&rsquo;t use that folder</p>
            <p className="mt-0.5 break-words text-[12.5px] leading-relaxed text-ink-body">{error}</p>
          </div>
        </div>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
          dragging ? "border-accent bg-accent/[0.06]" : "border-white/15 bg-white/[0.02]"
        } ${disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        <p className="font-display text-base font-semibold text-ink-heading">
          Drop a site folder or a .zip
        </p>
        <p className="mt-1 text-[13px] text-ink-body">Static output only — it&rsquo;s zipped in your browser and never stored loose.</p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              log("Choose folder clicked — opening the OS folder picker");
              if (!folderInput.current) log("⚠ folder input ref is null");
              folderInput.current?.click();
            }}
            className="rounded-full border border-white/15 bg-white/[0.04] px-5 py-2.5 text-[13px] font-semibold text-ink-heading transition-colors hover:border-white/30"
          >
            Choose folder
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              log("Choose .zip clicked");
              zipInput.current?.click();
            }}
            className="rounded-full border border-white/15 bg-white/[0.04] px-5 py-2.5 text-[13px] font-semibold text-ink-heading transition-colors hover:border-white/30"
          >
            Choose .zip
          </button>
        </div>

        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          // webkitdirectory/directory are non-standard but supported in
          // Chromium/WebKit — not in React's typed attribute set.
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => {
            const input = e.currentTarget;
            const files = Array.from(input.files ?? []);
            log(`folder input change — ${files.length} file(s)`);
            if (files.length) onSelect(files);
            else log("folder input fired with 0 files — nothing to do");
            // reset so re-picking the same folder fires onChange again
            input.value = "";
          }}
        />
        <input
          ref={zipInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            const input = e.currentTarget;
            const files = Array.from(input.files ?? []);
            log(`zip input change — ${files.length} file(s)`);
            if (files.length) onSelect(files);
            input.value = "";
          }}
        />
      </div>

      <div className="mt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-label">Or try a preset</p>
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => loadPreset("clean", "clean static export")}
            className="flex items-center justify-between rounded-lg border border-white/10 px-3.5 py-3 text-left text-[13px] text-ink-body transition-colors hover:border-strong hover:text-ink-heading disabled:opacity-50"
          >
            <span>Clean static export</span>
            <span className="text-[11px] text-ink-label">{loadingPreset === "clean" ? "loading…" : "sample-site"}</span>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => loadPreset("leaked-key", "leaked key in build output")}
            className="flex items-center justify-between rounded-lg border border-white/10 px-3.5 py-3 text-left text-[13px] text-ink-body transition-colors hover:border-strong hover:text-ink-heading disabled:opacity-50"
          >
            <span>Leaked key in build output — a known incident</span>
            <span className="text-[11px] text-ink-label">
              {loadingPreset === "leaked-key" ? "loading…" : "leaked-key-site"}
            </span>
          </button>
        </div>
      </div>

    </div>
  );
}

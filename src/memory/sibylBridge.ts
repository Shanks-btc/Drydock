/**
 * Node <-> Python bridge for sibyl-memory-client (see sibyl_bridge.py header
 * for why a subprocess, not literally the same process, is the closest thing
 * to "in-process" available when the SDK is Python-only and Drydock's
 * backend is Node). One spawn per call — simple and crash-isolated; the
 * hackathon-scale incident volume this build expects doesn't need a
 * persistent worker.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_SCRIPT = path.join(HERE, "sibyl_bridge.py");

// Override with SIBYL_PYTHON_BIN to point at the interpreter that has
// sibyl-memory-client installed. Defaults: on Windows, a verified absolute
// path for this dev machine (`python`/`python3` on PATH there can resolve to
// the Windows Store stub, which hangs on stdin instead of erroring); on
// Linux/macOS — e.g. the Railway container — plain `python3` on PATH.
const DEFAULT_PYTHON_BIN =
  process.platform === "win32"
    ? "C:\\Users\\Kelvin\\AppData\\Local\\Python\\bin\\python.exe"
    : "python3";
const PYTHON_BIN = process.env.SIBYL_PYTHON_BIN ?? DEFAULT_PYTHON_BIN;

const DB_PATH = process.env.SIBYL_MEMORY_DB; // undefined -> bridge's own default (~/.sibyl-memory/memory.db)
const TENANT_ID = process.env.SIBYL_TENANT_ID; // undefined -> DEFAULT_TENANT

export class SibylBridgeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recovery?: string | null,
  ) {
    super(message);
    this.name = "SibylBridgeError";
  }
}

interface BridgeResponse {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; recovery?: string | null };
}

function callBridge(op: string, args: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Node ALWAYS pipes the request as UTF-8. Without this, Python on Windows
    // opens stdin/stdout with the ANSI code page (cp1252) + surrogateescape —
    // so any non-ASCII byte in the payload is mis-decoded, and bytes that are
    // undefined in cp1252 (0x81/0x8D/0x8F/0x90/0x9D — all valid UTF-8
    // continuation bytes) become lone surrogates (\udc90 …) that
    // sibyl-memory-client then can't re-encode to UTF-8 for SQLite
    // ("UnicodeEncodeError: surrogates not allowed"). Pin both ends to UTF-8.
    const child = spawn(PYTHON_BIN, [BRIDGE_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) =>
      reject(new SibylBridgeError(`failed to spawn ${PYTHON_BIN}: ${err.message}`, "SPAWN_ERROR")),
    );
    child.on("close", (code) => {
      if (stdout.trim() === "") {
        reject(
          new SibylBridgeError(
            `sibyl_bridge.py produced no output (exit ${code}). stderr: ${stderr.slice(0, 2000)}`,
            "BRIDGE_NO_OUTPUT",
          ),
        );
        return;
      }
      let parsed: BridgeResponse;
      try {
        parsed = JSON.parse(stdout);
      } catch (err) {
        reject(
          new SibylBridgeError(
            `sibyl_bridge.py returned non-JSON: ${stdout.slice(0, 2000)}`,
            "BRIDGE_BAD_OUTPUT",
          ),
        );
        return;
      }
      if (!parsed.ok) {
        const e = parsed.error ?? { code: "UNKNOWN", message: "bridge reported failure with no error detail" };
        // Include the Python stderr (traceback) when present — a bare
        // "UnicodeEncodeError: …" message with no location is hard to debug.
        const detail = stderr.trim() ? `${e.message}\n--- bridge stderr ---\n${stderr.trim().slice(0, 4000)}` : e.message;
        reject(new SibylBridgeError(detail, e.code, e.recovery));
        return;
      }
      resolve(parsed.result);
    });
    child.stdin.write(JSON.stringify({ op, args, db_path: DB_PATH, tenant_id: TENANT_ID }), "utf8");
    child.stdin.end();
  });
}

// --- Typed wrappers, one per architecture.md §2 primitive ------------------

export function getEntity(category: string, name: string): Promise<{ body: unknown; status: string | null } | null> {
  return callBridge("get_entity", { category, name }) as Promise<any>;
}

export function listEntities(
  category?: string,
  opts: { status?: string; limit?: number } = {},
): Promise<Array<{ id: string; category: string; name: string; status: string | null; body: unknown }>> {
  return callBridge("list_entities", { category, ...opts }) as Promise<any>;
}

export function setEntity(
  category: string,
  name: string,
  body: Record<string, unknown>,
  status?: string,
): Promise<unknown> {
  return callBridge("set_entity", { category, name, body, status });
}

export function writeEvent(event: {
  evaluated?: unknown;
  acted?: unknown;
  forward?: unknown;
  extra?: unknown;
  ts?: string;
}): Promise<string> {
  return callBridge("write_event", event) as Promise<string>;
}

export function readEvents(opts: { limit?: number; since?: string; until?: string } = {}): Promise<any[]> {
  return callBridge("read_events", opts) as Promise<any[]>;
}

export function setReference(
  key: string,
  body: unknown,
  metadata?: Record<string, unknown>,
): Promise<void> {
  return callBridge("set_reference", { key, body, metadata }) as Promise<void>;
}

export function getReference(key: string): Promise<{ body: unknown; metadata: unknown; updated_at: string } | null> {
  return callBridge("get_reference", { key }) as Promise<any>;
}

export function setState(key: string, body: unknown): Promise<void> {
  return callBridge("set_state", { key, body }) as Promise<void>;
}

export function getState(key: string): Promise<{ body: unknown; updated_at: string } | null> {
  return callBridge("get_state", { key }) as Promise<any>;
}

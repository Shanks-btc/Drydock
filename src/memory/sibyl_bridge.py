#!/usr/bin/env python3
"""Sibyl Memory bridge — the ONLY place Drydock touches sibyl-memory-client.

sibyl-memory-client is a Python package (verified installed: 0.8.0). Drydock's
backend is Node/TypeScript. There is no Node SDK, so "in-process" (the
architecture.md §2.1 / memory finding "SDK, not MCP, for writes") is
satisfied the only way it can be here: this script imports MemoryClient
directly and calls its methods in-process *within this Python process* — it
does NOT go through the sibyl-memory-mcp server (a separate long-running
process with its own lossy 8-tool protocol, see §2.1). Node reaches this via
a single spawned subprocess per call (src/memory/sibylBridge.ts) — the
subprocess boundary is a Node<->Python language gap, not the MCP hop the
finding warned about; every method call below is a direct SDK call, full
field control (evaluated/acted/forward/extra/ts, set_reference, etc.).

Protocol: one JSON object on stdin, one JSON object on stdout.
  in:  {"op": "<method>", "args": {...}, "db_path"?: str, "tenant_id"?: str}
  out: {"ok": true, "result": <value>} | {"ok": false, "error": {"code","message","recovery"}}

Supported ops map 1:1 to MemoryClient methods used by architecture.md §2:
get_entity, set_entity, list_entities, write_event, read_events,
set_reference, get_reference, set_state, get_state.
"""
import json
import sys

from sibyl_memory_client import MemoryClient
from sibyl_memory_client.exceptions import NotFoundError, SibylMemoryError

DEFAULT_DB = "~/.sibyl-memory/memory.db"


def _client(db_path, tenant_id):
    # Free tier, no sibyl init, no bound account — the resolved decision in
    # architecture.md's banner and §9 Q5. tenant_id defaults to
    # MemoryClient's own DEFAULT_TENANT when not passed.
    kwargs = {"tier": "free"}
    if tenant_id:
        kwargs["tenant_id"] = tenant_id
    return MemoryClient.local(db_path or DEFAULT_DB, **kwargs)


def _dispatch(client, op, args):
    if op == "get_entity":
        try:
            return client.get_entity(args["category"], args["name"])
        except NotFoundError:
            # §6 pseudocode: "ledger = get_entity(...)  # may be NotFound" —
            # the Node caller treats this the same as "no ledger row yet".
            return None
    if op == "set_entity":
        return client.set_entity(
            args["category"], args["name"], args["body"], status=args.get("status")
        )
    if op == "list_entities":
        kwargs = {}
        if args.get("category") is not None:
            kwargs["category"] = args["category"]
        if args.get("status") is not None:
            kwargs["status"] = args["status"]
        if args.get("limit") is not None:
            kwargs["limit"] = args["limit"]
        return client.list_entities(**kwargs)
    if op == "write_event":
        return client.write_event(
            evaluated=args.get("evaluated"),
            acted=args.get("acted"),
            forward=args.get("forward"),
            extra=args.get("extra"),
            ts=args.get("ts"),
        )
    if op == "read_events":
        kwargs = {}
        if "limit" in args and args["limit"] is not None:
            kwargs["limit"] = args["limit"]
        if "since" in args and args["since"] is not None:
            kwargs["since"] = args["since"]
        if "until" in args and args["until"] is not None:
            kwargs["until"] = args["until"]
        return client.read_events(**kwargs)
    if op == "set_reference":
        client.set_reference(args["key"], args["body"], metadata=args.get("metadata"))
        return None
    if op == "get_reference":
        return client.get_reference(args["key"])
    if op == "set_state":
        client.set_state(args["key"], args["body"])
        return None
    if op == "get_state":
        return client.get_state(args["key"])
    raise ValueError(f"unknown op {op!r}")


def main() -> int:
    raw = sys.stdin.read()
    try:
        req = json.loads(raw)
        op = req["op"]
        args = req.get("args", {})
        client = _client(req.get("db_path"), req.get("tenant_id"))
        result = _dispatch(client, op, args)
        json.dump({"ok": True, "result": result}, sys.stdout)
        return 0
    except SibylMemoryError as e:
        json.dump(
            {
                "ok": False,
                "error": {
                    "code": getattr(e, "code", "SIBYL_MEMORY_ERROR"),
                    "message": str(e),
                    "recovery": getattr(e, "recovery", None),
                },
            },
            sys.stdout,
        )
        return 0
    except Exception as e:  # bridge/protocol errors — malformed request, etc.
        import traceback

        traceback.print_exc(file=sys.stderr)  # full trace to stderr for the Node caller
        json.dump(
            {"ok": False, "error": {"code": "BRIDGE_ERROR", "message": f"{type(e).__name__}: {e}"}},
            sys.stdout,
        )
        return 0


if __name__ == "__main__":
    sys.exit(main())

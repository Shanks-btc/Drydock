#!/usr/bin/env node
// TEST INFRASTRUCTURE — a transparent proxy in front of an x402 facilitator
// that fault-injects the SETTLE step to reproduce the real, observed,
// intermittent soft-failure of the public x402.org facilitator
// (docs/plan.md Day 7: `{ success:false, errorReason:
// "invalid_exact_evm_transaction_failed" }`, HTTP 200, never throws — the
// facilitator's own submitter-nonce race).
//
// /verify and /supported pass through untouched (verification is REAL).
// The first FF_SOFTFAIL_FIRST calls to /settle return a synthetic soft
// failure with HTTP 200 (matching the real shape — @x402/core's
// settleResponseSchema: { success, errorReason, errorMessage, payer,
// transaction, network }); every settle after that passes through to the
// real upstream and really settles on-chain.
//
// Usage:
//   FF_PORT=3999 FF_UPSTREAM=https://x402.org/facilitator FF_SOFTFAIL_FIRST=1 \
//     node scripts/fault-facilitator-proxy.mjs

import http from "node:http";

const PORT = Number(process.env.FF_PORT ?? 3999);
const UPSTREAM = (process.env.FF_UPSTREAM ?? "https://x402.org/facilitator").replace(/\/$/, "");
let softFailBudget = Number(process.env.FF_SOFTFAIL_FIRST ?? 1);

const log = (...a) => console.log("[fault-facilitator]", ...a);

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const body = await readBody(req);

  if (req.method === "POST" && url.pathname.endsWith("/settle") && softFailBudget > 0) {
    softFailBudget -= 1;
    let payer = "0x0000000000000000000000000000000000000000";
    let network = "eip155:84532";
    try {
      const parsed = JSON.parse(body.toString());
      payer =
        parsed?.paymentPayload?.payload?.authorization?.from ??
        parsed?.paymentPayload?.payload?.from ??
        payer;
      network = parsed?.paymentRequirements?.network ?? network;
    } catch {
      /* keep defaults */
    }
    const synthetic = {
      success: false,
      errorReason: "invalid_exact_evm_transaction_failed",
      errorMessage:
        "Missing or invalid parameters.\nDetails: replacement transaction underpriced\n" +
        "(fault-injected by scripts/fault-facilitator-proxy.mjs — reproduces the real " +
        "intermittent x402.org facilitator settle race; retry sends a fresh payment)",
      payer,
      transaction: "",
      network,
    };
    log(`/settle -> INJECTED soft-fail (${softFailBudget} left) payer=${payer}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(synthetic));
    return;
  }

  // Pass-through (verify, supported, and settle once the budget is spent).
  const target = `${UPSTREAM}${url.pathname.replace(/^\/+/, "/")}${url.search}`;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers["content-length"];
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (url.pathname.endsWith("/settle")) {
      log(`/settle -> PASS-THROUGH to upstream (status ${upstream.status})`);
    }
    const outHeaders = {};
    upstream.headers.forEach((v, k) => {
      if (!["content-encoding", "transfer-encoding", "connection"].includes(k)) outHeaders[k] = v;
    });
    res.writeHead(upstream.status, outHeaders);
    res.end(buf);
  } catch (err) {
    log(`proxy error for ${target}: ${err.message}`);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `fault-facilitator upstream failed: ${err.message}` }));
  }
});

server.listen(PORT, () => {
  log(`listening on http://localhost:${PORT} -> ${UPSTREAM}  (soft-fail first ${softFailBudget} settle call(s))`);
});

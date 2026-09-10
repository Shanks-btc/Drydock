/**
 * Wire x402 settlement -> deploy.
 *
 * The deploy action fires from `onAfterSettle`, gated on
 * `context.result.success`. This is deliberate, per the x402 finding:
 *
 *   A facilitator SOFT failure returns `{ success: false }` from settle()
 *   WITHOUT throwing. A thrown settle() goes to `onSettleFailure`; a
 *   `{ success: false }` return does NOT — it only ever reaches
 *   `onAfterSettle`. So a deploy trigger keyed to `onSettleFailure` (or to a
 *   try/catch around the SDK call) would happily deploy for a payment that
 *   never actually settled. The only correct gate is:
 *       onAfterSettle  +  context.result.success === true
 *
 * In @x402/express v2.23 this hook is `await`ed inside processSettlement,
 * before the buffered handler response is flushed. So ONLY the work we
 * actually await here delays the payer's HTTP response.
 *
 * NON-BLOCKING RELATIVE TO PAYMENT (Day 6 intent, restored 2026-09-07):
 * payment confirmation and the memory-check verdict are two SEPARABLE
 * events. This hook awaits exactly one thing — `markPaid` (a synchronous
 * CAS) — and then returns, so the payer's POST resolves the instant payment
 * is committed. The memory-check gate + publish run as a detached task
 * (`runGateAndPublish`, NOT awaited); the deploy record transitions
 * `paid -> (deploying -> live | failed) | blocked` on its own, and the
 * client polls `GET /deploy/:id` to observe it. An earlier version awaited
 * the whole gate+publish here, which collapsed the two events into one ~10s
 * response and made the scan step invisible to the client.
 *
 * Day 6 — the memory-check gate sits between payment and publish:
 *
 *   onAfterSettle (success) -> markPaid (payment ALWAYS commits, sync) ->
 *     [detached] checkDeployAgainstKnownPatterns -> either
 *       clean:   runDeploy  (unchanged Day 4 behavior)
 *       blocked: blockDeploy, do NOT call host.deploy, record the incident
 *
 * The gate controls whether the DEPLOY proceeds, never whether the PAYMENT
 * does. `markPaid` runs first and is not rolled back if the gate blocks —
 * the payer paid for a deploy attempt and a real answer (clean or blocked),
 * not a guarantee of publish. No override/manual-proceed flow yet (Day 7 UI).
 *
 * Day 6.5 — a blocked deploy is also written to Sibyl as an incident
 * (recordBlockedDeployAsIncident), so the incident-memory activity log is
 * real. The block is the primary effect; a failed incident write is logged
 * and swallowed — it never un-blocks or fails the deploy.
 */

import type { x402ResourceServer } from "@x402/express";
import { deployIdFromPath } from "../payment.ts";
import type { DeployPipeline } from "./pipeline.ts";
import type { StaticHost } from "./hosts.ts";
import { checkDeployAgainstKnownPatterns } from "../memory/deployGate.ts";
import { recordBlockedDeployAsIncident } from "../memory/recordBlockedDeploy.ts";

export function wireDeployOnSettlement(
  resourceServer: x402ResourceServer,
  pipeline: DeployPipeline,
  host: StaticHost,
  log: (msg: string) => void = console.log,
): void {
  resourceServer.onAfterSettle((context: any) => {
    const result = context?.result;
    const path: string | undefined = context?.transportContext?.request?.path;
    const deployId = deployIdFromPath(path);

    if (!deployId) {
      log(`[settlement] onAfterSettle: no deploy id in path ${path ?? "<none>"} — ignoring`);
      return;
    }

    // THE GATE (x402): a soft failure ({ success: false }, not thrown) lands here too.
    if (!result?.success) {
      log(
        `[settlement] deploy ${deployId}: settlement NOT successful ` +
          `(success=${result?.success} reason=${result?.errorReason ?? "?"}) — not deploying`,
      );
      return;
    }

    // CAS awaiting_payment -> paid. Payment is now committed, full stop —
    // nothing after this line ever un-commits it. False = hook already
    // handled (re-fire) or the record isn't in a payable state.
    const claimed = pipeline.markPaid(deployId, {
      payerAddress: result.payer,
      txHash: result.transaction,
    });
    if (!claimed) {
      log(`[settlement] deploy ${deployId}: already past awaiting_payment — skipping`);
      return;
    }
    log(`[settlement] deploy ${deployId}: paid by ${result.payer} (tx ${result.transaction})`);

    // --- Detached: the memory-check gate + publish. NOT awaited, so the
    // payer's HTTP response returns now, with payment confirmed. The record
    // moves paid -> ... on its own; the client polls for the verdict.
    void runGateAndPublish(deployId, pipeline, host, log);
  });
}

/**
 * The memory-check gate, then publish-or-block. Runs detached from the
 * settlement response (see the module header). Never throws out — every
 * failure path is logged and recorded on the deploy record. The deploy is
 * in state `paid` on entry; it leaves in `deploying`/`live`/`failed` (clean)
 * or `blocked` (matched, or gate errored — fail-closed).
 */
async function runGateAndPublish(
  deployId: string,
  pipeline: DeployPipeline,
  host: StaticHost,
  log: (msg: string) => void,
): Promise<void> {
  const rec = pipeline.get(deployId);
  if (!rec) {
    log(`[settlement] deploy ${deployId}: record vanished before the gate ran — nothing to do`);
    return;
  }

  // THE GATE (memory-check, Day 6): does this build carry a known failure
  // signal? Fail-closed on error — see deployGate.ts header.
  let gate;
  try {
    gate = await checkDeployAgainstKnownPatterns(deployId, rec.srcDir);
    pipeline.recordGateResult(deployId, gate);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[settlement] deploy ${deployId}: GATE CHECK FAILED (fail-closed, not deploying) — ${msg}`);
    pipeline.blockDeploy(deployId); // reuses "blocked"; distinguishable via gate=undefined on the record
    return;
  }

  if (gate.verdict === "blocked") {
    const claimedBlock = pipeline.blockDeploy(deployId);
    log(
      `[settlement] deploy ${deployId}: BLOCKED — pattern=${gate.topMatch?.pattern_id} ` +
        `confidence=${gate.topMatch?.confidence} — ${gate.topMatch?.rationale}`,
    );
    // Only the call that actually did the paid->blocked transition records
    // the incident — a re-fired hook must not double-write.
    if (claimedBlock && gate.topMatch) {
      try {
        const { eventId, outcome } = await recordBlockedDeployAsIncident(deployId, gate);
        log(`[settlement] deploy ${deployId}: incident ${outcome} in Sibyl (event ${eventId ?? "—"})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`[settlement] deploy ${deployId}: WARNING — incident write failed, block still stands: ${msg}`);
      }
    }
    return;
  }

  log(
    `[settlement] deploy ${deployId}: gate clean (${gate.signalsExtracted} signal(s), ` +
      `${gate.knownPatternsChecked} known pattern(s) checked) — deploying via ${host.name}`,
  );
  try {
    const record = await pipeline.runDeploy(deployId, host);
    if (record.state === "live") {
      log(`[settlement] deploy ${deployId}: LIVE at ${record.url}`);
    } else {
      log(`[settlement] deploy ${deployId}: FAILED — ${record.error}`);
    }
  } catch (err) {
    // runDeploy records its own failures on the record and doesn't throw,
    // but guard anyway — a detached task must never surface an unhandled
    // rejection.
    const msg = err instanceof Error ? err.message : String(err);
    log(`[settlement] deploy ${deployId}: publish task threw — ${msg}`);
  }
}

// Wrong-network guard for injected browser wallets (MetaMask & compatible).
//
// Built from the wallet-chain-validation skill. A viem/EIP-1193 client on
// `window.ethereum` has NO chain enforcement — every read/write silently
// targets whatever network the wallet currently has active. A wrong-network
// call often just returns empty ("0x") rather than erroring clearly, which
// looks like a broken contract. Call ensureChain() before the FIRST contract
// touch of any flow (reads included), not just before signing.
//
// Depends only on the raw EIP-1193 provider — no viem, no wallet SDK.

import { ACTIVE_CHAIN, type ChainConfig } from "./chain";

/** Minimal EIP-1193 provider surface we use. `window.ethereum` satisfies this. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/**
 * Real-world fix carried from Metron's production build: MetaMask does not
 * reliably set `code: 4902` (the EIP-3085 "chain not configured" signal) for a
 * chain it has never seen. What actually comes back is a generic error whose
 * *message* reads like `Unrecognized chain ID "0x14a34". Try adding the chain
 * using wallet_addEthereumChain first.` with no matching top-level `.code`.
 * Check the code where present; otherwise match the telltale wording.
 */
export function isUnrecognizedChainError(err: unknown): boolean {
  const e = err as { code?: number; cause?: { code?: number; message?: string }; message?: string } | undefined;
  if (e?.code === 4902 || e?.cause?.code === 4902) return true;
  const message = String(e?.message ?? e?.cause?.message ?? "");
  return /unrecognized chain|chain id .* not|add(ing)? the chain/i.test(message);
}

function pickMessage(err: unknown, fallback: string): string {
  const e = err as { shortMessage?: string; message?: string } | undefined;
  return e?.shortMessage ?? e?.message ?? fallback;
}

/**
 * Ensure the wallet's ACTIVE network is `chain` (defaults to ACTIVE_CHAIN —
 * Base Sepolia in the hackathon config). Switches, adds-then-switches if the
 * wallet doesn't have it, and re-verifies. Throws a specific, user-readable
 * error at every rejection point (never a generic catch-all — a declined
 * switch must not surface later as a cryptic contract error).
 *
 * @param eth       The injected provider (`window.ethereum`).
 * @param chain     Target chain config. Defaults to ACTIVE_CHAIN.
 * @param onProgress Optional progress callback for UI.
 */
export async function ensureChain(
  eth: Eip1193Provider,
  chain: ChainConfig = ACTIVE_CHAIN,
  onProgress?: (message: string) => void | Promise<void>,
): Promise<void> {
  const currentHex = (await eth.request({ method: "eth_chainId" })) as string;
  if (parseInt(currentHex, 16) === chain.chainId) {
    return; // already correct — the common case, nothing observable
  }

  await onProgress?.(`Wallet is on the wrong network — requesting switch to ${chain.chainName}...`);

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chain.chainIdHex }],
    });
  } catch (switchError: unknown) {
    if (isUnrecognizedChainError(switchError)) {
      await onProgress?.(`${chain.chainName} not found in wallet — adding it...`);
      try {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chain.chainIdHex,
              chainName: chain.chainName,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: chain.rpcUrls,
              blockExplorerUrls: chain.blockExplorerUrls,
            },
          ],
        });
      } catch (addError: unknown) {
        if ((addError as { code?: number })?.code === 4001) {
          throw new Error(`Adding ${chain.chainName} was declined in the wallet — it's required to continue.`);
        }
        throw new Error(pickMessage(addError, `Could not add ${chain.chainName} to your wallet.`));
      }

      // wallet_addEthereumChain usually also switches, but that's not
      // guaranteed for every wallet — explicitly retry rather than assume.
      try {
        await eth.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chain.chainIdHex }],
        });
      } catch (retryError: unknown) {
        if ((retryError as { code?: number })?.code === 4001) {
          throw new Error(`Network switch declined in the wallet — ${chain.chainName} is required to continue.`);
        }
        throw new Error(pickMessage(retryError, `Could not switch to ${chain.chainName} after adding it.`));
      }
    } else if ((switchError as { code?: number })?.code === 4001) {
      throw new Error(`Network switch declined in the wallet — ${chain.chainName} is required to continue.`);
    } else {
      throw new Error(pickMessage(switchError, `Could not switch your wallet to ${chain.chainName}.`));
    }
  }

  // Never trust switch/add resolving without error — some wallets resolve
  // early or resolve a stale queued request. Re-read and confirm.
  const confirmedHex = (await eth.request({ method: "eth_chainId" })) as string;
  if (parseInt(confirmedHex, 16) !== chain.chainId) {
    throw new Error(`Wallet is still not on ${chain.chainName} — please switch networks manually and try again.`);
  }

  await onProgress?.(`Switched to ${chain.chainName}.`);
}

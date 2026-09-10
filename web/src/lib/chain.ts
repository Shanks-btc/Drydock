// Base chain configuration — data only, no wallet/SDK calls.
//
// Day 2 groundwork for the eventual x402 payment flow. The wrong-network
// guard (`ensureChain`) that consumes this is Day 3 integration code and is
// NOT in this file yet — see docs/plan.md.
//
// PROVENANCE (per the wallet-chain-validation skill: "don't invent them").
// Drydock is a fresh repo with nothing to grep, so values are sourced from:
//   1. The installed x402 SDK's own network table —
//      @x402/evm  EVM_NETWORK_CHAIN_ID_MAP  ->  base: 8453, "base-sepolia": 84532
//      (node_modules in the sibling Metron project, @x402/evm@2.23.0)
//   2. The x402 SDK's DEFAULT_ASSETS table for the USDC settlement asset +
//      its EIP-712 domain (name/version) per network — see USDC_BY_NETWORK below.
//   3. A working, deployed x402-on-Base integration in the sibling project
//      Metron (web/src/lib/payX402.ts, src/server.ts) which uses exactly
//      these rpc/explorer values in production.
//   4. docs.base.org/chain/network-information — verified 2026-09-01 for BOTH
//      networks (chain ids, RPC URLs, explorers, ETH native currency).
// chainIdHex is DERIVED (`0x${n.toString(16)}`), never hand-typed (EIP-3085).

export interface ChainConfig {
  chainId: number;
  /** Derived from chainId per EIP-3085 — see toHexChainId(). */
  chainIdHex: string;
  chainName: string;
  /** Base's native gas currency is ETH (18 decimals) — NOT USDC. USDC is only
   *  the x402 settlement token (see USDC_BY_NETWORK), never the native currency. */
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
  /** CAIP-2 id the x402 SDK keys schemes by: always `eip155:<chainId>`. */
  caip2: `eip155:${number}`;
}

/** `"0x" + chainId.toString(16)` — the one correct way to get chainIdHex. */
export function toHexChainId(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

export const BASE_MAINNET: ChainConfig = {
  chainId: 8453,
  chainIdHex: toHexChainId(8453), // "0x2105"
  chainName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  // Public endpoint — rate-limited. Swap for a dedicated RPC (Alchemy/Infura/
  // QuickNode) before anything load-bearing; kept here because it's the
  // canonical default and needs no key for a demo.
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
  caip2: "eip155:8453",
};

export const BASE_SEPOLIA: ChainConfig = {
  // All values verified 2026-09-01 against docs.base.org/chain/network-information
  // (chain id 84532 / 0x14A34, ETH native) AND the x402 SDK's own
  // EVM_NETWORK_CHAIN_ID_MAP + DEFAULT_ASSETS. Two independent sources agree.
  chainId: 84532,
  chainIdHex: toHexChainId(84532), // "0x14a34" (EIP-3085 accepts either case)
  chainName: "Base Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://sepolia.base.org"],
  blockExplorerUrls: ["https://sepolia.basescan.org"],
  caip2: "eip155:84532",
};

/**
 * USDC settlement asset per network, copied verbatim from the x402 SDK's
 * DEFAULT_ASSETS table (@x402/evm/dist/esm/chunk-53LRAEB5.mjs). `name` /
 * `version` are the token's EIP-712 domain fields — they must match the
 * on-chain contract's domain separator or every EIP-3009 signature fails
 * before a request is sent. Note mainnet USDC name is "USD Coin" but Base
 * Sepolia test USDC name is "USDC" — they are NOT the same string.
 */
export const USDC_BY_NETWORK: Record<
  ChainConfig["caip2"],
  { address: `0x${string}`; decimals: number; eip712Name: string; eip712Version: string }
> = {
  "eip155:8453": {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    eip712Name: "USD Coin",
    eip712Version: "2",
  },
  "eip155:84532": {
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    decimals: 6,
    eip712Name: "USDC",
    eip712Version: "2",
  },
};

/**
 * The chain Drydock's payment flow targets.
 *
 * Hackathon default is **Base Sepolia** — real x402 flow, test USDC, no
 * mainnet funds at risk. Set NEXT_PUBLIC_X402_NETWORK=eip155:8453 to go to
 * mainnet (and set the server's X402_NETWORK to match — the two must always
 * agree, per Metron's hard-won convention).
 */
export const ACTIVE_CHAIN: ChainConfig =
  process.env.NEXT_PUBLIC_X402_NETWORK === "eip155:8453" ? BASE_MAINNET : BASE_SEPOLIA;

/** USDC settlement asset for the active chain. */
export const ACTIVE_USDC = USDC_BY_NETWORK[ACTIVE_CHAIN.caip2];

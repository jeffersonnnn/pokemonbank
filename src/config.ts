import type { Config } from "./types";

export function loadConfig(): Config {
  const required = (key: string): string => {
    const val = process.env[key];
    if (!val) throw new Error(`Missing required env var: ${key}`);
    return val;
  };

  return {
    rpcUrl: required("SOLANA_RPC_URL"),
    heliusApiKey: required("HELIUS_API_KEY"),
    walletPrivateKey: required("WALLET_PRIVATE_KEY"),
    tokenMint: required("TOKEN_MINT"),
    collectionSlug: required("ME_COLLECTION_SLUG"),
    minDrawAmount: BigInt(process.env.MIN_DRAW_AMOUNT ?? "500000"),
    cycleIntervalMs: Number(process.env.CYCLE_INTERVAL_MINUTES ?? "10") * 60 * 1000,
  };
}

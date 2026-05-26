import { log } from "./logger";
import type { TokenHolder } from "./types";

export async function getTokenHolders(
  tokenMint: string,
  heliusApiKey: string,
): Promise<TokenHolder[]> {
  const holders: TokenHolder[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "holders",
          method: "getTokenAccounts",
          params: { mint: tokenMint, limit: 1000, page },
        }),
      },
    );

    const data: any = await res.json();
    const accounts = data.result?.token_accounts ?? [];

    if (accounts.length === 0) break;

    for (const acc of accounts) {
      const balance = BigInt(acc.amount ?? "0");
      if (balance > 0n) {
        holders.push({ address: acc.owner, balance });
      }
    }

    page++;
    if (accounts.length < 1000) break;
  }

  log.info("Token holders fetched", { count: holders.length });
  return holders;
}

export function pickRandomWinner(holders: TokenHolder[]): TokenHolder | null {
  if (holders.length === 0) return null;
  const index = Math.floor(Math.random() * holders.length);
  return holders[index];
}

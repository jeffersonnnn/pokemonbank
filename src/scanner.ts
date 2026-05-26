import { log } from "./logger";
import type { SwapTx } from "./types";

/**
 * Scan recent transactions on the token's PumpSwap pool to find
 * the biggest seller and all buyers in the last cycle window.
 *
 * Uses Helius enhanced transaction API to parse swap events.
 */
export async function scanPoolActivity(
  tokenMint: string,
  heliusApiKey: string,
  windowMs: number,
): Promise<{ sellers: SwapTx[]; buyers: SwapTx[] }> {
  const url = `https://api.helius.xyz/v0/addresses/${tokenMint}/transactions?api-key=${heliusApiKey}&type=SWAP&limit=100`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Helius transactions API error: ${res.status}`);
  }

  const txs: any[] = await res.json();
  const cutoff = Date.now() - windowMs;
  const sellers: SwapTx[] = [];
  const buyers: SwapTx[] = [];

  for (const tx of txs) {
    const txTime = (tx.timestamp ?? 0) * 1000;
    if (txTime < cutoff) continue;

    const swapEvent = tx.events?.swap;
    if (!swapEvent) continue;

    const tokenIn = swapEvent.tokenInputs?.find(
      (t: any) => t.mint === tokenMint,
    );
    const tokenOut = swapEvent.tokenOutputs?.find(
      (t: any) => t.mint === tokenMint,
    );

    const signer = tx.feePayer || tx.signer || "";

    if (tokenIn && !tokenOut) {
      sellers.push({
        signature: tx.signature,
        wallet: signer,
        type: "sell",
        tokenAmount: BigInt(tokenIn.rawTokenAmount?.tokenAmount ?? "0"),
        timestamp: txTime,
      });
    } else if (tokenOut && !tokenIn) {
      buyers.push({
        signature: tx.signature,
        wallet: signer,
        type: "buy",
        tokenAmount: BigInt(tokenOut.rawTokenAmount?.tokenAmount ?? "0"),
        timestamp: txTime,
      });
    }
  }

  log.info("Pool activity scanned", {
    window: `${windowMs / 60000}m`,
    sellers: sellers.length,
    buyers: buyers.length,
  });

  return { sellers, buyers };
}

export function findBiggestSeller(sellers: SwapTx[]): SwapTx | null {
  if (sellers.length === 0) return null;
  return sellers.reduce((biggest, current) =>
    current.tokenAmount > biggest.tokenAmount ? current : biggest,
  );
}

export function findBountyHunter(
  buyers: SwapTx[],
  threshold: bigint,
  afterTimestamp: number,
): SwapTx | null {
  const eligible = buyers
    .filter((b) => b.tokenAmount >= threshold && b.timestamp > afterTimestamp)
    .sort((a, b) => a.timestamp - b.timestamp);

  return eligible.length > 0 ? eligible[0] : null;
}

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { loadConfig } from "./config";
import { claimCreatorFees } from "./claimer";
import { getTokenHolders, pickRandomWinner } from "./holders";
import { getCheapestListing, buyListedNft } from "./marketplace";
import { loadState, saveState, recordDraw } from "./state";
import { getTokenBalance, swapUsdcToSol, transferNft } from "./transaction";
import { USDC_MINT } from "./constants";
import { log } from "./logger";
import type { BotState, CycleResult } from "./types";

let state: BotState = loadState();

// ── Web server (always starts) ──────────────────────────────
function getPublicState() {
  return {
    draws: state.draws.slice(0, 20),
    totalDraws: state.totalDraws,
    totalSolSpent: state.totalSolSpent,
    holderCount: state.holderCount,
    currentPotUsdc: state.currentPotUsdc,
    floorPriceSol: state.floorPriceSol,
    floorNftName: state.floorNftName,
    floorNftImage: state.floorNftImage,
    lastCycleTimestamp: state.lastCycleTimestamp,
  };
}

const API_PORT = 3900;
const SITE_DIR = import.meta.dir + "/../site";

Bun.serve({
  port: API_PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/state") {
      return new Response(JSON.stringify(getPublicState()), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const htmlFile = Bun.file(`${SITE_DIR}/index.html`);
    if (await htmlFile.exists()) {
      return new Response(htmlFile, {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});
log.info(`Server running on http://localhost:${API_PORT}`);

// ── Bot cycle (only runs with full credentials) ─────────────
async function runCycle(
  config: ReturnType<typeof loadConfig>,
  connection: Connection,
  wallet: Keypair,
): Promise<CycleResult> {
  const result: CycleResult = {
    timestamp: new Date(),
    usdcClaimed: 0n,
    holderCount: 0,
    winner: null,
    nftBought: false,
    nftMint: null,
    errors: [],
  };

  try {
    // Step 1: Claim USDC creator fees
    log.bounty("STEP 1 - Claim USDC creator rewards");
    const claimed = await claimCreatorFees(connection, wallet);
    result.usdcClaimed = claimed;

    const usdcBalance = await getTokenBalance(
      connection, USDC_MINT, wallet.publicKey,
    );
    state.currentPotUsdc = Number(usdcBalance) / 1e6;
    log.info("USDC pot", { balance: state.currentPotUsdc.toFixed(2) });

    // Step 2: Check collection floor price
    log.bounty("STEP 2 - Check collection floor");
    const listing = await getCheapestListing(config.collectionSlug);

    if (listing) {
      state.floorPriceSol = listing.price;
      state.floorNftName = listing.name;
      state.floorNftImage = listing.image;
      log.info("Floor listing", {
        name: listing.name,
        price: `${listing.price} SOL`,
      });
    } else {
      log.info("No listings available");
      state.lastCycleTimestamp = Date.now();
      saveState(state);
      return result;
    }

    // Step 3: Check if pot covers floor price
    const solLamports = Math.ceil(listing.price * 1e9);
    const priceCheckRes = await fetch(
      `https://api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=${solLamports}&slippageBps=100`,
    );

    if (!priceCheckRes.ok) {
      log.error("Jupiter price check failed");
      state.lastCycleTimestamp = Date.now();
      saveState(state);
      return result;
    }

    const priceCheck: any = await priceCheckRes.json();
    const usdcNeeded = BigInt(priceCheck.outAmount) * 115n / 100n;

    if (usdcBalance < usdcNeeded) {
      log.info("Pot too small for floor", {
        have: `$${state.currentPotUsdc.toFixed(2)}`,
        need: `$${(Number(usdcNeeded) / 1e6).toFixed(2)}`,
      });
      state.lastCycleTimestamp = Date.now();
      saveState(state);
      return result;
    }

    // Step 4: Snapshot holders and pick winner
    log.bounty("STEP 3 - Lottery draw");
    const holders = await getTokenHolders(
      config.tokenMint, config.heliusApiKey,
    );
    state.holderCount = holders.length;
    result.holderCount = holders.length;

    const winner = pickRandomWinner(holders);
    if (!winner) {
      log.info("No holders found");
      state.lastCycleTimestamp = Date.now();
      saveState(state);
      return result;
    }

    result.winner = winner.address;
    log.info("WINNER", {
      wallet: winner.address.slice(0, 8) + "...",
      balance: winner.balance.toString(),
    });

    // Step 5: Swap USDC to SOL
    log.bounty("STEP 4 - Swap USDC to SOL");
    await swapUsdcToSol(connection, wallet, usdcNeeded);

    // Step 6: Buy the NFT
    log.bounty("STEP 5 - Buy Pokemon card");
    const buySignature = await buyListedNft(connection, wallet, listing);
    result.nftBought = true;
    result.nftMint = listing.mint;

    // Step 7: Transfer NFT to winner
    log.bounty("STEP 6 - Transfer card to winner");
    const transferSig = await transferNft(
      connection,
      wallet,
      new PublicKey(listing.mint),
      new PublicKey(winner.address),
    );

    recordDraw(state, {
      winner: winner.address,
      nftMint: listing.mint,
      nftName: listing.name,
      nftImage: listing.image,
      solPrice: listing.price,
      timestamp: Date.now(),
      buySignature,
      transferSignature: transferSig,
    });

    const newBalance = await getTokenBalance(
      connection, USDC_MINT, wallet.publicKey,
    );
    state.currentPotUsdc = Number(newBalance) / 1e6;

    log.info("DRAW COMPLETE", {
      winner: winner.address.slice(0, 8) + "...",
      card: listing.name,
      price: `${listing.price} SOL`,
    });

    state.lastCycleTimestamp = Date.now();
    saveState(state);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(msg);
    log.error("Cycle failed", err);
    state.lastCycleTimestamp = Date.now();
    saveState(state);
  }

  return result;
}

function logResult(result: CycleResult) {
  console.log("\n" + "-".repeat(60));
  log.info("CYCLE COMPLETE", {
    usdcClaimed: `${Number(result.usdcClaimed) / 1e6} USDC`,
    holders: result.holderCount,
    winner: result.winner?.slice(0, 8) ?? "none",
    nftBought: result.nftBought,
    errors: result.errors.length,
  });
  console.log("-".repeat(60) + "\n");
}

try {
  const config = loadConfig();
  const connection = new Connection(config.rpcUrl, "confirmed");
  const wallet = Keypair.fromSecretKey(bs58.decode(config.walletPrivateKey));

  log.info("BOUNTYBANK Pokemon Lottery starting", {
    wallet: wallet.publicKey.toBase58(),
    tokenMint: config.tokenMint,
    collection: config.collectionSlug,
    cycleInterval: `${config.cycleIntervalMs / 60_000}m`,
  });

  (async () => {
    log.info("Running initial cycle...");
    const result = await runCycle(config, connection, wallet);
    logResult(result);

    log.info(`Next draw in ${config.cycleIntervalMs / 60_000} minutes`);
    setInterval(async () => {
      const result = await runCycle(config, connection, wallet);
      logResult(result);
    }, config.cycleIntervalMs);
  })();
} catch {
  log.warn("Bot cycle disabled (missing credentials). Frontend-only mode.");
}

import {
  Connection,
  Keypair,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  PublicKey,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { log } from "./logger";

const USDC_MINT_STR = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT_STR = "So11111111111111111111111111111111111111112";

export async function buildAndSendTx(
  connection: Connection,
  instructions: TransactionInstruction[],
  signer: Keypair,
  priorityFee: number = 50_000,
): Promise<string> {
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
    ...instructions,
  ];

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([signer]);

  const sig = await connection.sendTransaction(tx, {
    skipPreflight: false,
    maxRetries: 3,
  });

  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );

  return sig;
}

export async function getTokenBalance(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
  try {
    const balance = await connection.getTokenAccountBalance(ata);
    return BigInt(balance.value.amount);
  } catch {
    return 0n;
  }
}

export async function sendUsdc(
  connection: Connection,
  wallet: Keypair,
  recipient: PublicKey,
  usdcMint: PublicKey,
  amount: bigint,
): Promise<string> {
  const senderAta = getAssociatedTokenAddressSync(
    usdcMint, wallet.publicKey, true, TOKEN_PROGRAM_ID,
  );
  const recipientAta = getAssociatedTokenAddressSync(
    usdcMint, recipient, true, TOKEN_PROGRAM_ID,
  );

  const ixs: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey, recipientAta, recipient, usdcMint, TOKEN_PROGRAM_ID,
    ),
    createTransferInstruction(senderAta, recipientAta, wallet.publicKey, amount),
  ];

  return buildAndSendTx(connection, ixs, wallet);
}

export async function transferNft(
  connection: Connection,
  wallet: Keypair,
  nftMint: PublicKey,
  recipient: PublicKey,
): Promise<string> {
  const senderAta = getAssociatedTokenAddressSync(
    nftMint, wallet.publicKey, true, TOKEN_PROGRAM_ID,
  );
  const recipientAta = getAssociatedTokenAddressSync(
    nftMint, recipient, true, TOKEN_PROGRAM_ID,
  );

  const ixs: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey, recipientAta, recipient, nftMint, TOKEN_PROGRAM_ID,
    ),
    createTransferInstruction(senderAta, recipientAta, wallet.publicKey, 1),
  ];

  return buildAndSendTx(connection, ixs, wallet);
}

export async function swapUsdcToSol(
  connection: Connection,
  wallet: Keypair,
  usdcAmount: bigint,
): Promise<{ solReceived: number; signature: string }> {
  const quoteRes = await fetch(
    `https://quote-api.jup.ag/v6/quote?inputMint=${USDC_MINT_STR}&outputMint=${SOL_MINT_STR}&amount=${usdcAmount}&slippageBps=100`,
  );
  if (!quoteRes.ok) throw new Error(`Jupiter quote failed: ${quoteRes.status}`);
  const quote = await quoteRes.json();

  const swapRes = await fetch("https://quote-api.jup.ag/v6/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 50000,
    }),
  });
  if (!swapRes.ok) throw new Error(`Jupiter swap failed: ${swapRes.status}`);
  const swapData: any = await swapRes.json();

  const tx = VersionedTransaction.deserialize(
    Buffer.from(swapData.swapTransaction, "base64"),
  );
  tx.sign([wallet]);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    maxRetries: 3,
  });

  const bh = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");

  const solReceived = Number(quote.outAmount) / 1e9;
  log.info("USDC->SOL swap", {
    usdcIn: (Number(usdcAmount) / 1e6).toFixed(2),
    solOut: solReceived.toFixed(4),
    signature: sig,
  });

  return { solReceived, signature: sig };
}

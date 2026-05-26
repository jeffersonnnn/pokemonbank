import { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  coinCreatorVaultAuthorityPda,
  coinCreatorVaultAtaPda,
  PUMP_AMM_SDK,
} from "@pump-fun/pump-swap-sdk";
import { USDC_MINT } from "./constants";
import { buildAndSendTx, getTokenBalance } from "./transaction";
import { log } from "./logger";

export async function claimCreatorFees(
  connection: Connection,
  wallet: Keypair,
): Promise<bigint> {
  const creator = wallet.publicKey;
  const balanceBefore = await getTokenBalance(connection, USDC_MINT, creator);

  const instructions = await buildClaimInstructions(connection, creator);
  if (instructions.length === 0) {
    log.info("No creator fee instructions to execute");
    return 0n;
  }

  const sig = await buildAndSendTx(connection, instructions, wallet);
  log.info("Claim tx confirmed", { signature: sig });

  const balanceAfter = await getTokenBalance(connection, USDC_MINT, creator);
  const claimed = balanceAfter - balanceBefore;
  log.info("USDC claimed", { amount: claimed.toString() });

  return claimed;
}

async function buildClaimInstructions(
  connection: Connection,
  coinCreator: PublicKey,
): Promise<TransactionInstruction[]> {
  const quoteMint = USDC_MINT;
  const quoteTokenProgram = TOKEN_PROGRAM_ID;

  const coinCreatorVaultAuthority = coinCreatorVaultAuthorityPda(coinCreator);
  const coinCreatorVaultAta = coinCreatorVaultAtaPda(
    coinCreatorVaultAuthority,
    quoteMint,
    quoteTokenProgram,
  );

  const coinCreatorTokenAccount = getAssociatedTokenAddressSync(
    quoteMint,
    coinCreator,
    true,
    quoteTokenProgram,
  );

  const accountInfos = await connection.getMultipleAccountsInfo([
    coinCreatorVaultAta,
    coinCreatorTokenAccount,
  ]);
  const coinCreatorVaultAtaAccountInfo = accountInfos[0] ?? null;
  const coinCreatorTokenAccountInfo = accountInfos[1] ?? null;

  if (!coinCreatorVaultAtaAccountInfo) {
    log.info("No AMM creator vault found");
    return [];
  }

  const ixs: TransactionInstruction[] = [];

  if (!coinCreatorTokenAccountInfo) {
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        coinCreator,
        coinCreatorTokenAccount,
        coinCreator,
        quoteMint,
        quoteTokenProgram,
      ),
    );
  }

  const collectIxs = await PUMP_AMM_SDK.collectCoinCreatorFee(
    {
      coinCreator,
      quoteMint,
      quoteTokenProgram,
      coinCreatorVaultAuthority,
      coinCreatorVaultAta,
      coinCreatorTokenAccount,
      coinCreatorVaultAtaAccountInfo,
      coinCreatorTokenAccountInfo,
    },
    coinCreator,
  );

  ixs.push(...collectIxs);
  return ixs;
}

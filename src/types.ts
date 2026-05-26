export interface Config {
  rpcUrl: string;
  heliusApiKey: string;
  walletPrivateKey: string;
  tokenMint: string;
  collectionSlug: string;
  minDrawAmount: bigint;
  cycleIntervalMs: number;
}

export interface TokenHolder {
  address: string;
  balance: bigint;
}

export interface NftListing {
  mint: string;
  seller: string;
  price: number;
  name: string;
  image: string;
}

export interface LotteryDraw {
  winner: string;
  nftMint: string;
  nftName: string;
  nftImage: string;
  solPrice: number;
  timestamp: number;
  buySignature: string;
  transferSignature: string;
}

export interface BotState {
  draws: LotteryDraw[];
  totalDraws: number;
  totalSolSpent: number;
  holderCount: number;
  currentPotUsdc: number;
  floorPriceSol: number;
  floorNftName: string;
  floorNftImage: string;
  lastCycleTimestamp: number;
}

export interface CycleResult {
  timestamp: Date;
  usdcClaimed: bigint;
  holderCount: number;
  winner: string | null;
  nftBought: boolean;
  nftMint: string | null;
  errors: string[];
}

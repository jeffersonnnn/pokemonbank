import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { log } from "./logger";
import type { NftListing } from "./types";

const ME_API = "https://api-mainnet.magiceden.dev/v2";

export async function getCheapestListing(
  collectionSlug: string,
): Promise<NftListing | null> {
  const url = `${ME_API}/collections/${collectionSlug}/listings?offset=0&limit=1`;
  const res = await fetch(url);

  if (!res.ok) {
    log.error("ME listings failed", new Error(`${res.status}`));
    return null;
  }

  const listings: any[] = await res.json();
  if (listings.length === 0) return null;

  const l = listings[0];
  let name = l.extra?.name ?? "";
  let image = l.extra?.img ?? "";

  if (!name || !image) {
    const meta = await fetchTokenMeta(l.tokenMint);
    if (meta) {
      name = name || meta.name;
      image = image || meta.image;
    }
  }

  return {
    mint: l.tokenMint,
    seller: l.seller,
    price: l.price,
    name: name || `Card ${l.tokenMint.slice(0, 8)}`,
    image,
  };
}

async function fetchTokenMeta(
  mint: string,
): Promise<{ name: string; image: string } | null> {
  try {
    const res = await fetch(`${ME_API}/tokens/${mint}`);
    if (!res.ok) return null;
    const d: any = await res.json();
    return { name: d.name ?? "", image: d.image ?? "" };
  } catch {
    return null;
  }
}

export async function buyListedNft(
  connection: Connection,
  buyer: Keypair,
  listing: NftListing,
): Promise<string> {
  const params = new URLSearchParams({
    buyer: buyer.publicKey.toBase58(),
    seller: listing.seller,
    tokenMint: listing.mint,
    tokenATA: "",
    price: listing.price.toString(),
    buyerReferral: "",
    sellerExpiry: "-1",
    auctionHouseAddress: "",
    buyerCreatorRoyaltyPercent: "0",
  });

  const res = await fetch(`${ME_API}/instructions/buy_now?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ME buy failed: ${res.status} - ${body}`);
  }

  const data: any = await res.json();

  const txBytes = data.v0?.data ?? data.tx?.data;
  if (!txBytes) {
    throw new Error(
      "Unexpected ME tx format: " + JSON.stringify(Object.keys(data)),
    );
  }

  const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
  tx.sign([buyer]);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    maxRetries: 3,
  });

  const bh = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");

  log.info("NFT purchased", {
    mint: listing.mint,
    price: listing.price,
    signature: sig,
  });
  return sig;
}

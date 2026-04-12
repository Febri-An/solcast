/**
 * Pyth price feed helpers for the prediction market.
 *
 * Implements the "Price Update Account" flow:
 *   1. Fetch latest price data from Hermes (Pyth's off-chain API)
 *   2. Post the price update to Solana via the Pyth Receiver program
 *   3. Invoke resolve_market — outcome is determined automatically on-chain
 *      by comparing the Pyth price against the market's stored target_price.
 */

import { HermesClient } from "@pythnetwork/hermes-client";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import type { Wallet } from "@coral-xyz/anchor";

const HERMES_URL = "https://hermes.pyth.network/";
const PREDICTION_MARKET_PROGRAM_ID = new PublicKey(
  "DYy72hMhhyHvbPjy71pp4137U4FumNuzM6i3mLVU2MWk",
);
const RESOLVE_MARKET_DISCRIMINATOR = Buffer.from([
  155, 23, 80, 173, 46, 74, 23, 239,
]);

function feedIdBytesToHex(feedId: ArrayLike<number>): string {
  return (
    "0x" +
    Array.from(feedId)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

async function fetchPriceUpdateData(feedIdHex: string): Promise<string[]> {
  const hermes = new HermesClient(HERMES_URL);
  const result = await hermes.getLatestPriceUpdates([feedIdHex], {
    encoding: "base64",
  });
  return result.binary.data;
}

function buildResolveMarketIx(
  resolver: PublicKey,
  market: PublicKey,
  priceUpdate: PublicKey,
): TransactionInstruction {
  // resolve_market has no args (outcome is determined on-chain), only the discriminator
  const data = RESOLVE_MARKET_DISCRIMINATOR;

  return new TransactionInstruction({
    programId: PREDICTION_MARKET_PROGRAM_ID,
    keys: [
      { pubkey: resolver, isSigner: true, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: priceUpdate, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Resolve a prediction market using a verified Pyth price update.
 *
 * Fetches the latest price for the market's feed from Hermes, posts it
 * on-chain via the Pyth Receiver program, then invokes resolve_market.
 * The on-chain program compares the Pyth price against the market's
 * target_price and sets outcome automatically.
 *
 * @param feedId - The market's Pyth feed ID (32 bytes, from market.feedId)
 */
export async function resolveMarketWithPyth(
  connection: Connection,
  wallet: Wallet,
  marketAddress: string,
  feedId: ArrayLike<number>,
): Promise<string[]> {
  const feedIdHex = feedIdBytesToHex(feedId);
  const priceUpdateData = await fetchPriceUpdateData(feedIdHex);

  const pythReceiver = new PythSolanaReceiver({ connection, wallet });
  const txBuilder = pythReceiver.newTransactionBuilder({
    closeUpdateAccounts: true,
  });

  await txBuilder.addPostPriceUpdates(priceUpdateData);

  await txBuilder.addPriceConsumerInstructions(
    async (getPriceUpdateAccount) => {
      const priceUpdatePubkey = getPriceUpdateAccount(feedIdHex);
      const ix = buildResolveMarketIx(
        wallet.publicKey,
        new PublicKey(marketAddress),
        priceUpdatePubkey,
      );
      return [{ instruction: ix, signers: [] }];
    },
  );

  const transactions = await txBuilder.buildVersionedTransactions({
    computeUnitPriceMicroLamports: 50000,
  });

  return await pythReceiver.provider.sendAll(transactions, {
    skipPreflight: true,
  });
}

/**
 * Pyth price feed helpers for the prediction market.
 *
 * Implements the "Price Update Account" flow:
 *   1. Fetch latest price data from Hermes (Pyth's off-chain API)
 *   2. Post the price update to Solana via the Pyth Receiver program
 *   3. Invoke our resolve_market instruction with the price update account
 *
 * All three steps are bundled into versioned transactions by the Pyth SDK
 * and sent in sequence.
 */

import { HermesClient } from "@pythnetwork/hermes-client";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import type { Wallet } from "@coral-xyz/anchor";

export const BTC_USD_FEED_ID =
  "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

const HERMES_URL = "https://hermes.pyth.network/";
const PREDICTION_MARKET_PROGRAM_ID = new PublicKey(
  "DYy72hMhhyHvbPjy71pp4137U4FumNuzM6i3mLVU2MWk",
);
const RESOLVE_MARKET_DISCRIMINATOR = Buffer.from([
  155, 23, 80, 173, 46, 74, 23, 239,
]);

export async function fetchPriceUpdateData(): Promise<string[]> {
  const hermes = new HermesClient(HERMES_URL);
  const result = await hermes.getLatestPriceUpdates([BTC_USD_FEED_ID], {
    encoding: "base64",
  });
  return result.binary.data;
}

function buildResolveMarketIx(
  creator: PublicKey,
  market: PublicKey,
  priceUpdate: PublicKey,
  outcome: boolean,
): TransactionInstruction {
  const data = Buffer.alloc(9);
  RESOLVE_MARKET_DISCRIMINATOR.copy(data, 0);
  data.writeUInt8(outcome ? 1 : 0, 8);

  return new TransactionInstruction({
    programId: PREDICTION_MARKET_PROGRAM_ID,
    keys: [
      { pubkey: creator, isSigner: true, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: priceUpdate, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Resolve a prediction market using a verified Pyth price update.
 *
 * Fetches the latest BTC/USD price from Hermes, posts it on-chain via the
 * Pyth Receiver program, then invokes `resolve_market` on the prediction
 * market program with that price update account.
 *
 * Returns an array of transaction signatures (posting price data may require
 * multiple transactions).
 */
export async function resolveMarketWithPyth(
  connection: Connection,
  wallet: Wallet,
  marketAddress: string,
  outcome: boolean,
): Promise<string[]> {
  const priceUpdateData = await fetchPriceUpdateData();

  const pythReceiver = new PythSolanaReceiver({ connection, wallet });
  const txBuilder = pythReceiver.newTransactionBuilder({
    closeUpdateAccounts: true,
  });

  await txBuilder.addPostPriceUpdates(priceUpdateData);

  await txBuilder.addPriceConsumerInstructions(
    async (getPriceUpdateAccount) => {
      const priceUpdatePubkey = getPriceUpdateAccount(BTC_USD_FEED_ID);
      const ix = buildResolveMarketIx(
        wallet.publicKey,
        new PublicKey(marketAddress),
        priceUpdatePubkey,
        outcome,
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

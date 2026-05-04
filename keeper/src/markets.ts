import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  MARKET_DISCRIMINATOR,
  getMarketDecoder,
  type Market,
} from "../../app/generated/prediction_market/accounts/market";

export type MarketRecord = {
  address: PublicKey;
  lamports: number;
  data: Market;
};

const decoder = getMarketDecoder();

export async function fetchAllMarkets(
  connection: Connection,
  programId: PublicKey,
): Promise<MarketRecord[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: bs58.encode(MARKET_DISCRIMINATOR),
        },
      },
    ],
  });

  const records: MarketRecord[] = [];
  for (const { pubkey, account } of accounts) {
    try {
      const market = decoder.decode(new Uint8Array(account.data));
      records.push({ address: pubkey, lamports: account.lamports, data: market });
    } catch (err) {
      console.warn(
        `[markets] Failed to decode account ${pubkey.toBase58()}:`,
        (err as Error).message,
      );
    }
  }
  return records;
}

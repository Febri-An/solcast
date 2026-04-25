/**
 * Client-side PDA derivations mirroring the Anchor program's `seeds` macros.
 * Used for write-through after a transaction lands so we can look up the
 * created/mutated account on RPC and upsert it into `markets_cache` /
 * `positions_cache` without scanning the whole program.
 */

import {
  getAddressEncoder,
  getBytesEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  type Address,
} from "@solana/kit";

import { PREDICTION_MARKET_PROGRAM_ADDRESS } from "../generated/prediction_market";

const MARKET_SEED = new Uint8Array([109, 97, 114, 107, 101, 116]); // "market"
const POSITION_SEED = new Uint8Array([112, 111, 115, 105, 116, 105, 111, 110]); // "position"

export async function deriveMarketAddress(
  creator: Address,
  marketId: bigint,
): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PREDICTION_MARKET_PROGRAM_ADDRESS,
    seeds: [
      getBytesEncoder().encode(MARKET_SEED),
      getAddressEncoder().encode(creator),
      getU64Encoder().encode(marketId),
    ],
  });
  return pda;
}

export async function deriveUserPositionAddress(
  market: Address,
  user: Address,
): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PREDICTION_MARKET_PROGRAM_ADDRESS,
    seeds: [
      getBytesEncoder().encode(POSITION_SEED),
      getAddressEncoder().encode(market),
      getAddressEncoder().encode(user),
    ],
  });
  return pda;
}

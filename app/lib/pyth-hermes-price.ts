import type { ReadonlyUint8Array } from "@solana/kit";

import { feedIdBytesToHex } from "./price-feeds";

const HERMES_URL = "https://hermes.pyth.network/";

export { HERMES_URL };

export function feedIdToHermesHex(feedId: ReadonlyUint8Array): string {
  return `0x${feedIdBytesToHex(feedId)}`;
}

export function pythPriceFromParsedComponent(price: {
  price: string;
  expo: number;
}): number {
  return Number(price.price) * 10 ** price.expo;
}

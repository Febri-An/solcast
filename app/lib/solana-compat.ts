/**
 * Bridge between @solana/kit (WalletSession) and @solana/web3.js (Connection/Wallet).
 *
 * The Pyth SDK (@pythnetwork/pyth-solana-receiver) depends on legacy @solana/web3.js
 * types. This module adapts the wallet-standard WalletSession into the Anchor Wallet
 * interface that PythSolanaReceiver expects.
 *
 * The bridge works at the byte level: both stacks use the same Solana wire format,
 * so we serialize web3.js VersionedTransaction → decode as kit Transaction → sign
 * via WalletSession → encode back → deserialize to web3.js VersionedTransaction.
 */

import {
  Connection,
  PublicKey,
  VersionedTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  getTransactionDecoder,
  getTransactionEncoder,
} from "@solana/kit";
import type { Wallet } from "@coral-xyz/anchor";
import type { WalletSession } from "@solana/client";

const DEVNET_RPC_URL = "https://api.devnet.solana.com";

export function getWeb3Connection(): Connection {
  return new Connection(DEVNET_RPC_URL, "confirmed");
}

export function createAnchorWallet(session: WalletSession): Wallet {
  if (!session.signTransaction) {
    throw new Error(
      "Connected wallet does not support signTransaction. " +
        "Please use a wallet that supports the solana:signTransaction feature.",
    );
  }

  const publicKey = new PublicKey(session.account.address);
  const decoder = getTransactionDecoder();
  const encoder = getTransactionEncoder();

  async function signOne<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    const rawBytes = tx.serialize();
    const kitTx = decoder.decode(rawBytes);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signedKitTx = await session.signTransaction!(kitTx as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signedBytes = encoder.encode(signedKitTx as any);

    const signedBuf = new Uint8Array(signedBytes);
    if (tx instanceof VersionedTransaction) {
      return VersionedTransaction.deserialize(signedBuf) as T;
    }
    return Transaction.from(Buffer.from(signedBuf)) as T;
  }

  // PythSolanaReceiver only uses publicKey + sign methods at runtime.
  // The class type also declares `payer: Keypair` (for Node usage), which
  // doesn't apply in a browser wallet context.
  return {
    publicKey,
    signTransaction: signOne,
    signAllTransactions: <T extends Transaction | VersionedTransaction>(
      txs: T[],
    ): Promise<T[]> => Promise.all(txs.map(signOne)),
  } as unknown as Wallet;
}

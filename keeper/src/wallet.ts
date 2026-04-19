import fs from "node:fs";
import {
  Keypair,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type { Wallet } from "@coral-xyz/anchor";

export function loadKeypair(filePath: string): Keypair {
  const raw = fs.readFileSync(filePath, "utf8");
  const arr = JSON.parse(raw) as unknown;
  if (!Array.isArray(arr) || arr.length !== 64) {
    throw new Error(
      `Invalid keypair file at ${filePath}: expected JSON array of 64 numbers`,
    );
  }
  return Keypair.fromSecretKey(Uint8Array.from(arr as number[]));
}

/**
 * Wrap a Keypair in an Anchor-compatible Wallet (as required by
 * PythSolanaReceiver).
 */
export function keypairWallet(kp: Keypair): Wallet {
  const signOne = async <T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> => {
    if (tx instanceof VersionedTransaction) {
      tx.sign([kp]);
    } else {
      tx.partialSign(kp);
    }
    return tx;
  };

  return {
    publicKey: kp.publicKey,
    payer: kp,
    signTransaction: signOne,
    signAllTransactions: <T extends Transaction | VersionedTransaction>(
      txs: T[],
    ): Promise<T[]> => Promise.all(txs.map((tx) => signOne(tx))),
  } as Wallet;
}

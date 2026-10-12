export type CardCategory = "debit" | "credit" | "virtual" | "gift";
export type CardAccent = "aurora" | "ocean" | "rose" | "gold";
export type TransactionKind = "payment" | "topup" | "withdrawal" | "refund";
export type Language = "en" | "tr";
export type Theme = "dark" | "light";
export type NavigationSection = "overview" | "cards" | "activity" | "security";

export interface VaultCard {
  id: string;
  name: string;
  holder: string;
  category: CardCategory;
  bank: string;
  number: string;
  expiry: string;
  accent: CardAccent;
  favorite: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LedgerTransaction {
  id: string;
  cardId: string;
  cardLabel: string;
  kind: TransactionKind;
  description: string;
  amount: number;
  currency: "TRY";
  occurredAt: string;
  note: string;
}

export interface VaultData {
  schemaVersion: 1;
  cards: VaultCard[];
  transactions: LedgerTransaction[];
}

/** Current envelope: a random data key encrypts the vault and is wrapped by both credentials. */
export interface EncryptedVaultRecordV2 {
  format: "cardvault-encrypted-v2";
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  cipher: "AES-GCM-256";
  passwordSalt: string;
  passwordIv: string;
  wrappedDataKey: string;
  recoverySalt: string;
  recoveryIv: string;
  wrappedRecoveryDataKey: string;
  payloadIv: string;
  ciphertext: string;
  updatedAt: string;
}

/** Read-only support for v1 vaults created by the first CardVault Studio release. */
export interface LegacyEncryptedVaultRecord {
  format: "cardvault-encrypted-v1";
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  cipher: "AES-GCM-256";
  salt: string;
  iv: string;
  ciphertext: string;
  updatedAt: string;
}

export type EncryptedVaultRecord = EncryptedVaultRecordV2 | LegacyEncryptedVaultRecord;

export type PendingAction =
  | { kind: "save-card"; card: VaultCard; wasEditing: boolean }
  | { kind: "delete-card"; cardId: string };

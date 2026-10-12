import type {
  EncryptedVaultRecord,
  EncryptedVaultRecordV2,
  LegacyEncryptedVaultRecord,
  VaultData,
} from "@/lib/types";

export const VAULT_STORAGE_KEY = "cardvault.encrypted.v1";
export const KDF_ITERATIONS = 310_000;
const V1_FORMAT = "cardvault-encrypted-v1" as const;
const V2_FORMAT = "cardvault-encrypted-v2" as const;
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+-_?";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function getCrypto(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw new Error("Secure browser cryptography is unavailable. Open this app in a modern browser on localhost.");
  }
  return globalThis.crypto;
}

function isV2(record: EncryptedVaultRecord): record is EncryptedVaultRecordV2 {
  return record.format === V2_FORMAT;
}

async function deriveWrappingKey(password: string, salt: Uint8Array, iterations = KDF_ITERATIONS): Promise<CryptoKey> {
  const cryptoApi = getCrypto();
  const material = await cryptoApi.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return cryptoApi.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function importDataKey(raw: Uint8Array): Promise<CryptoKey> {
  return getCrypto().subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

async function wrapDataKey(rawDataKey: Uint8Array, wrappingKey: CryptoKey): Promise<{ iv: string; wrapped: string }> {
  const cryptoApi = getCrypto();
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const wrapped = await cryptoApi.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, rawDataKey as BufferSource);
  return { iv: toBase64(iv), wrapped: toBase64(new Uint8Array(wrapped)) };
}

async function unwrapDataKey(wrappedBase64: string, ivBase64: string, wrappingKey: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await getCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivBase64) as BufferSource },
    wrappingKey,
    fromBase64(wrappedBase64) as BufferSource,
  ));
}

async function encryptPayload(data: VaultData, dataKey: CryptoKey): Promise<{ payloadIv: string; ciphertext: string }> {
  const cryptoApi = getCrypto();
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await cryptoApi.subtle.encrypt({ name: "AES-GCM", iv }, dataKey, plaintext);
  return { payloadIv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

async function decryptPayload(ciphertext: string, iv: string, dataKey: CryptoKey): Promise<VaultData> {
  const raw = await getCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) as BufferSource },
    dataKey,
    fromBase64(ciphertext) as BufferSource,
  );
  const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
  if (!isVaultData(parsed)) throw new Error("Vault payload is invalid.");
  return parsed;
}

/** Generates a cryptographically random 16-character recovery code containing every required character class. */
export function generateRecoveryCode(): string {
  const cryptoApi = getCrypto();
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*+-_?";
  const randomBelow = (max: number): number => {
    const maxUnbiasedByte = Math.floor(256 / max) * max;
    while (true) {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
      for (const byte of bytes) if (byte < maxUnbiasedByte) return byte % max;
    }
  };
  const pick = (alphabet: string): string => alphabet[randomBelow(alphabet.length)];
  const code = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (code.length < 16) code.push(pick(RECOVERY_ALPHABET));
  // Fisher–Yates shuffle with an unbiased random index at every position.
  for (let index = code.length - 1; index > 0; index -= 1) {
    const swapIndex = randomBelow(index + 1);
    [code[index], code[swapIndex]] = [code[swapIndex], code[index]];
  }
  return code.join("");
}

export function isValidRecoveryCode(value: string): boolean {
  return value.length === 16 &&
    [...value].every((character) => RECOVERY_ALPHABET.includes(character)) &&
    /[A-Z]/.test(value) && /[a-z]/.test(value) && /[2-9]/.test(value) && /[!@#$%&*+_?-]/.test(value);
}

export function extractRecoveryCodeFromText(contents: string): string | null {
  if (contents.length > 20_000) return null;
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    const labelled = /^(?:cardvault\s+)?recovery\s+(?:code|key)\s*:\s*(.+)$/i.exec(line);
    const candidate = labelled?.[1]?.trim() ?? line;
    if (isValidRecoveryCode(candidate)) return candidate;
  }
  return null;
}

/** Create a new vault with one random data key wrapped independently by the master password and recovery code. */
export async function createEncryptedVault(
  password: string,
  data: VaultData,
  recoveryCode = generateRecoveryCode(),
): Promise<{ record: EncryptedVaultRecordV2; key: CryptoKey; recoveryCode: string }> {
  if (!isValidRecoveryCode(recoveryCode)) throw new Error("Recovery code must contain exactly 16 supported characters.");
  const cryptoApi = getCrypto();
  const rawDataKey = cryptoApi.getRandomValues(new Uint8Array(32));
  const dataKey = await importDataKey(rawDataKey);
  const passwordSalt = cryptoApi.getRandomValues(new Uint8Array(16));
  const recoverySalt = cryptoApi.getRandomValues(new Uint8Array(16));
  const passwordWrappingKey = await deriveWrappingKey(password, passwordSalt);
  const recoveryWrappingKey = await deriveWrappingKey(recoveryCode, recoverySalt);
  const passwordWrapped = await wrapDataKey(rawDataKey, passwordWrappingKey);
  const recoveryWrapped = await wrapDataKey(rawDataKey, recoveryWrappingKey);
  const payload = await encryptPayload(data, dataKey);
  const record: EncryptedVaultRecordV2 = {
    format: V2_FORMAT,
    kdf: "PBKDF2-SHA-256",
    iterations: KDF_ITERATIONS,
    cipher: "AES-GCM-256",
    passwordSalt: toBase64(passwordSalt),
    passwordIv: passwordWrapped.iv,
    wrappedDataKey: passwordWrapped.wrapped,
    recoverySalt: toBase64(recoverySalt),
    recoveryIv: recoveryWrapped.iv,
    wrappedRecoveryDataKey: recoveryWrapped.wrapped,
    ...payload,
    updatedAt: new Date().toISOString(),
  };
  return { record, key: dataKey, recoveryCode };
}

/** Unlock current v2 records and the first release's v1 records for seamless migration. */
export async function unlockEncryptedVault(
  password: string,
  record: EncryptedVaultRecord,
): Promise<{ data: VaultData; key: CryptoKey; legacy: boolean }> {
  validateRecordMetadata(record);
  const cryptoApi = getCrypto();
  if (record.format === V1_FORMAT) {
    const salt = fromBase64(record.salt);
    const iv = fromBase64(record.iv);
    if (salt.byteLength !== 16 || iv.byteLength !== 12) throw new Error("Invalid encrypted vault metadata.");
    const legacyKey = await deriveWrappingKey(password, salt, record.iterations);
    try {
      const raw = await cryptoApi.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, legacyKey, fromBase64(record.ciphertext) as BufferSource);
      const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
      if (!isVaultData(parsed)) throw new Error("Vault payload is invalid.");
      return { data: parsed, key: legacyKey, legacy: true };
    } catch {
      throw new Error("The passphrase is incorrect, or the encrypted vault has been damaged.");
    }
  }

  const salt = fromBase64(record.passwordSalt);
  if (salt.byteLength !== 16) throw new Error("Invalid encrypted vault metadata.");
  try {
    const wrappingKey = await deriveWrappingKey(password, salt, record.iterations);
    const rawDataKey = await unwrapDataKey(record.wrappedDataKey, record.passwordIv, wrappingKey);
    if (rawDataKey.byteLength !== 32) throw new Error("Invalid wrapped data key.");
    const key = await importDataKey(rawDataKey);
    const data = await decryptPayload(record.ciphertext, record.payloadIv, key);
    return { data, key, legacy: false };
  } catch {
    throw new Error("The passphrase is incorrect, or the encrypted vault has been damaged.");
  }
}

export async function unlockEncryptedVaultWithRecovery(
  recoveryCode: string,
  record: EncryptedVaultRecord,
): Promise<{ data: VaultData; key: CryptoKey }> {
  if (!isValidRecoveryCode(recoveryCode)) throw new Error("The selected file does not contain a valid 16-character recovery code.");
  if (!isV2(record)) throw new Error("This older vault has no recovery-code envelope yet. Unlock it with the master password first.");
  validateRecordMetadata(record);
  try {
    const recoverySalt = fromBase64(record.recoverySalt);
    if (recoverySalt.byteLength !== 16) throw new Error("Invalid recovery salt.");
    const wrappingKey = await deriveWrappingKey(recoveryCode, recoverySalt, record.iterations);
    const rawDataKey = await unwrapDataKey(record.wrappedRecoveryDataKey, record.recoveryIv, wrappingKey);
    if (rawDataKey.byteLength !== 32) throw new Error("Invalid wrapped data key.");
    const key = await importDataKey(rawDataKey);
    return { data: await decryptPayload(record.ciphertext, record.payloadIv, key), key };
  } catch {
    throw new Error("The recovery code is incorrect, or the encrypted vault has been damaged.");
  }
}

export async function updateEncryptedVault(
  data: VaultData,
  key: CryptoKey,
  previousRecord: EncryptedVaultRecord,
): Promise<EncryptedVaultRecordV2> {
  if (!isV2(previousRecord)) throw new Error("Legacy vault must be migrated before changing data.");
  const payload = await encryptPayload(data, key);
  return { ...previousRecord, ...payload, updatedAt: new Date().toISOString() };
}

/** Rotates only the password wrapper; data and recovery-code wrappers remain valid. */
export async function rewrapVaultPassword(
  dataKey: CryptoKey,
  newPassword: string,
  record: EncryptedVaultRecord,
): Promise<EncryptedVaultRecordV2> {
  if (!isV2(record)) throw new Error("Legacy vault must be migrated before changing the passphrase.");
  const cryptoApi = getCrypto();
  const rawDataKey = new Uint8Array(await cryptoApi.subtle.exportKey("raw", dataKey));
  const passwordSalt = cryptoApi.getRandomValues(new Uint8Array(16));
  const passwordWrappingKey = await deriveWrappingKey(newPassword, passwordSalt, record.iterations);
  const wrapped = await wrapDataKey(rawDataKey, passwordWrappingKey);
  return {
    ...record,
    passwordSalt: toBase64(passwordSalt),
    passwordIv: wrapped.iv,
    wrappedDataKey: wrapped.wrapped,
    updatedAt: new Date().toISOString(),
  };
}

export function parseEncryptedVault(value: string): EncryptedVaultRecord {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("Backup is not valid JSON."); }
  if (!parsed || typeof parsed !== "object") throw new Error("This file is not a supported CardVault encrypted backup.");
  const record = parsed as Record<string, unknown>;
  if (record.format === V1_FORMAT && typeof record.salt === "string" && typeof record.iv === "string" && typeof record.ciphertext === "string") {
    const legacy: LegacyEncryptedVaultRecord = {
      format: V1_FORMAT,
      kdf: "PBKDF2-SHA-256",
      iterations: Number(record.iterations),
      cipher: "AES-GCM-256",
      salt: record.salt as string,
      iv: record.iv as string,
      ciphertext: record.ciphertext as string,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
    };
    validateRecordMetadata(legacy);
    return legacy;
  }
  if (
    record.format !== V2_FORMAT || record.kdf !== "PBKDF2-SHA-256" || record.cipher !== "AES-GCM-256" ||
    typeof record.passwordSalt !== "string" || typeof record.passwordIv !== "string" || typeof record.wrappedDataKey !== "string" ||
    typeof record.recoverySalt !== "string" || typeof record.recoveryIv !== "string" || typeof record.wrappedRecoveryDataKey !== "string" ||
    typeof record.payloadIv !== "string" || typeof record.ciphertext !== "string"
  ) throw new Error("This file is not a supported CardVault encrypted backup.");
  const current: EncryptedVaultRecordV2 = {
    format: V2_FORMAT,
    kdf: "PBKDF2-SHA-256",
    iterations: Number(record.iterations),
    cipher: "AES-GCM-256",
    passwordSalt: record.passwordSalt as string,
    passwordIv: record.passwordIv as string,
    wrappedDataKey: record.wrappedDataKey as string,
    recoverySalt: record.recoverySalt as string,
    recoveryIv: record.recoveryIv as string,
    wrappedRecoveryDataKey: record.wrappedRecoveryDataKey as string,
    payloadIv: record.payloadIv as string,
    ciphertext: record.ciphertext as string,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
  };
  validateRecordMetadata(current);
  return current;
}

function validateRecordMetadata(record: EncryptedVaultRecord): void {
  if (record.kdf !== "PBKDF2-SHA-256" || record.cipher !== "AES-GCM-256" ||
      !Number.isInteger(record.iterations) || record.iterations < 100_000 || record.iterations > 2_000_000) {
    throw new Error("Unsupported or invalid encrypted vault format.");
  }
  if (record.format === V1_FORMAT) {
    if (fromBase64(record.salt).byteLength !== 16 || fromBase64(record.iv).byteLength !== 12) throw new Error("Invalid encrypted vault metadata.");
  } else {
    if (fromBase64(record.passwordSalt).byteLength !== 16 || fromBase64(record.recoverySalt).byteLength !== 16 ||
      fromBase64(record.passwordIv).byteLength !== 12 || fromBase64(record.recoveryIv).byteLength !== 12 || fromBase64(record.payloadIv).byteLength !== 12) {
      throw new Error("Invalid encrypted vault metadata.");
    }
  }
}

export function isVaultData(value: unknown): value is VaultData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<VaultData>;
  return candidate.schemaVersion === 1 && Array.isArray(candidate.cards) && Array.isArray(candidate.transactions);
}

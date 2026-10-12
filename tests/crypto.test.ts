import { describe, expect, it } from "vitest";
import {
  createEncryptedVault,
  extractRecoveryCodeFromText,
  generateRecoveryCode,
  isValidRecoveryCode,
  parseEncryptedVault,
  rewrapVaultPassword,
  unlockEncryptedVault,
  unlockEncryptedVaultWithRecovery,
  updateEncryptedVault,
} from "@/lib/crypto";
import type { VaultData } from "@/lib/types";

const sampleData: VaultData = {
  schemaVersion: 1,
  cards: [{
    id: "test-card", name: "Test card", holder: "TEST USER", category: "debit", bank: "Example",
    number: "4111111111111111", expiry: "12/35", accent: "aurora", favorite: true, tags: ["test"],
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  }],
  transactions: [],
};
const password = "VaultPass8!";

describe("client-side vault encryption and recovery", () => {
  it("encrypts vault data under a random data key and unlocks using the master password", async () => {
    const { record } = await createEncryptedVault(password, sampleData);
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("4111111111111111");
    expect(serialized).not.toContain("TEST USER");
    expect(record.cipher).toBe("AES-GCM-256");
    expect(record.format).toBe("cardvault-encrypted-v2");
    expect((await unlockEncryptedVault(password, record)).data).toEqual(sampleData);
  });

  it("rejects an incorrect master password", async () => {
    const { record } = await createEncryptedVault(password, sampleData);
    await expect(unlockEncryptedVault("WrongPass8!", record)).rejects.toThrow("incorrect");
  });

  it("generates a 16-character recovery key that opens the same data", async () => {
    const { record, recoveryCode } = await createEncryptedVault(password, sampleData);
    expect(recoveryCode).toHaveLength(16);
    expect(/[A-Z]/.test(recoveryCode)).toBe(true);
    expect(/[a-z]/.test(recoveryCode)).toBe(true);
    expect(/[2-9]/.test(recoveryCode)).toBe(true);
    expect(/[!@#$%&*+_?-]/.test(recoveryCode)).toBe(true);
    expect(isValidRecoveryCode(recoveryCode)).toBe(true);
    expect((await unlockEncryptedVaultWithRecovery(recoveryCode, record)).data).toEqual(sampleData);
    await expect(unlockEncryptedVaultWithRecovery("wrong-recovery-key", record)).rejects.toThrow("valid 16-character");
  });

  it("extracts only a valid key from the downloaded TXT file contents", async () => {
    const recoveryCode = generateRecoveryCode();
    expect(extractRecoveryCodeFromText(`CARDVAULT STUDIO — RECOVERY KEY\n${recoveryCode}\nKeep this private.`)).toBe(recoveryCode);
    expect(extractRecoveryCodeFromText("this file has no key")).toBeNull();
    expect(extractRecoveryCodeFromText("X".repeat(20_001))).toBeNull();
  });

  it("re-encrypts payload updates with a new IV while keeping both credential wrappers intact", async () => {
    const { record, key, recoveryCode } = await createEncryptedVault(password, sampleData);
    const nextData = { ...sampleData, cards: [] } satisfies VaultData;
    const updated = await updateEncryptedVault(nextData, key, record);
    expect(updated.payloadIv).not.toBe(record.payloadIv);
    expect(updated.passwordSalt).toBe(record.passwordSalt);
    expect(updated.wrappedRecoveryDataKey).toBe(record.wrappedRecoveryDataKey);
    const parsed = parseEncryptedVault(JSON.stringify(updated));
    expect((await unlockEncryptedVault(password, parsed)).data).toEqual(nextData);
    expect((await unlockEncryptedVaultWithRecovery(recoveryCode, parsed)).data).toEqual(nextData);
  });

  it("rotates the master password without invalidating the recovery code", async () => {
    const { record, key, recoveryCode } = await createEncryptedVault(password, sampleData);
    const changed = await rewrapVaultPassword(key, "BetterPass9!", record);
    await expect(unlockEncryptedVault(password, changed)).rejects.toThrow("incorrect");
    expect((await unlockEncryptedVault("BetterPass9!", changed)).data).toEqual(sampleData);
    expect((await unlockEncryptedVaultWithRecovery(recoveryCode, changed)).data).toEqual(sampleData);
  });
});

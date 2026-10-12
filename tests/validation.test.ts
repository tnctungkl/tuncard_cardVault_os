import { describe, expect, it } from "vitest";
import {
  detectNetwork, filterTransactionsByPeriod, formatCardNumber, formatCardNumberInput, getMasterPasswordRules, isValidLuhn, isValidMasterPassword,
  normalizeCardNumber, sanitizeTags, validateCardForm,
} from "@/lib/validation";

describe("card validation helpers", () => {
  it("normalizes card numbers to digits only", () => {
    expect(normalizeCardNumber("4111 1111-1111 1111")).toBe("4111111111111111");
  });

  it("checks the Luhn checksum", () => {
    expect(isValidLuhn("4111 1111 1111 1111")).toBe(true);
    expect(isValidLuhn("4111 1111 1111 1112")).toBe(false);
    expect(isValidLuhn("123")).toBe(false);
  });

  it("detects common networks without contacting an external service", () => {
    expect(detectNetwork("4111111111111111")).toBe("VISA");
    expect(detectNetwork("5555555555554444")).toBe("MASTERCARD");
    expect(detectNetwork("378282246310005")).toBe("AMEX");
  });

  it("formats card input into four-digit groups as the user types", () => {
    expect(formatCardNumberInput("4111111111111111")).toBe("4111 1111 1111 1111");
    expect(formatCardNumberInput("4111 1111 1111 1111" )).toBe("4111 1111 1111 1111");
    expect(formatCardNumberInput("4111-1111-1111-1111 123")).toBe("4111 1111 1111 1111 123");
  });

  it("masks a card number by default and only reveals when asked", () => {
    expect(formatCardNumber("4111111111111111")).toBe("•••• •••• •••• 1111");
    expect(formatCardNumber("4111111111111111", true)).toBe("4111 1111 1111 1111");
    expect(formatCardNumber("")).toContain("••••");
  });

  it("normalizes tags and removes duplicates and angle brackets", () => {
    expect(sanitizeTags("daily, daily, <travel>, bills")).toEqual(["daily", "travel", "bills"]);
    expect(sanitizeTags(Array.from({ length: 12 }, (_, i) => `tag${i}`).join(","))).toHaveLength(10);
  });

  it("validates required card details and expiry formatting", () => {
    const base = { name: "Everyday", holder: "JOHN DOE", bank: "Example Bank", number: "4111111111111111", expiry: "12/35", tagsText: "daily", category: "debit" as const };
    expect(validateCardForm(base)).toBeNull();
    expect(validateCardForm({ ...base, number: "4111111111111112" })).toBe("invalidCardNumber");
    expect(validateCardForm({ ...base, expiry: "2028-12" })).toBe("invalidExpiry");
    expect(validateCardForm({ ...base, category: "gift", number: "1234567890123456" })).toBeNull();
    expect(validateCardForm({ ...base, number: "" })).toBe("cardNumberRequired");
    expect(validateCardForm({ ...base, number: "1234567890123456" })).toBe("invalidCardNumber");
  });
});

describe("transaction period filtering", () => {
  const now = Date.parse("2026-10-11T12:00:00.000Z");
  const rows = [
    { id: "recent", occurredAt: "2026-10-11T11:30:00.000Z" },
    { id: "yesterday", occurredAt: "2026-10-10T12:00:00.000Z" },
    { id: "old", occurredAt: "2026-07-01T12:00:00.000Z" },
    { id: "future", occurredAt: "2026-10-12T12:00:00.000Z" },
  ];

  it("applies the selected period and excludes future records", () => {
    expect(filterTransactionsByPeriod(rows, "1h", now).map((item) => item.id)).toEqual(["recent"]);
    expect(filterTransactionsByPeriod(rows, "1d", now).map((item) => item.id)).toEqual(["recent", "yesterday"]);
    expect(filterTransactionsByPeriod(rows, "3m", now).map((item) => item.id)).toEqual(["recent", "yesterday"]);
  });
});


describe("master password requirements", () => {
  it("accepts only 8–16 character passwords with the required character classes", () => {
    expect(isValidMasterPassword("VaultPass8!")).toBe(true);
    expect(isValidMasterPassword("Ab1!xyz")).toBe(false);
    expect(isValidMasterPassword("A".repeat(17) + "a1!")).toBe(false);
    expect(isValidMasterPassword("Abc12345" )).toBe(false);
  });

  it("rejects emoji, links, whitespace and four repeated digits", () => {
    expect(getMasterPasswordRules("Abcdef8!😀").safeCharacters).toBe(false);
    expect(isValidMasterPassword("Abcdef8!www.com")).toBe(false);
    expect(getMasterPasswordRules("Abcd1111!x").repeatedDigits).toBe(false);
    expect(getMasterPasswordRules("Abcd 123!x").safeCharacters).toBe(false);
  });
});

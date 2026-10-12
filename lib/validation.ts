import type { CardCategory, CardAccent, TransactionKind, VaultCard } from "@/lib/types";

export const CARD_CATEGORIES: CardCategory[] = ["debit", "credit", "virtual", "gift"];
export const CARD_ACCENTS: CardAccent[] = ["aurora", "ocean", "rose", "gold"];
export const TRANSACTION_KINDS: TransactionKind[] = ["payment", "topup", "withdrawal", "refund"];

export function normalizeCardNumber(value: string): string {
  return value.replace(/\D/g, "").slice(0, 19);
}

/** Formats card digits while typing, preserving standard 4-digit groups. */
export function formatCardNumberInput(value: string): string {
  const digits = normalizeCardNumber(value);
  return digits.match(/.{1,4}/g)?.join(" ") ?? "";
}

const PASSWORD_SPECIALS = "!@#$%^&*()-_=+[]{};:'\",.?/\\|~`";

export interface MasterPasswordRules {
  length: boolean;
  uppercase: boolean;
  lowercase: boolean;
  special: boolean;
  safeCharacters: boolean;
  repeatedDigits: boolean;
}

export function getMasterPasswordRules(password: string): MasterPasswordRules {
  const urlLike = /(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|io|dev|co|tr|app|info|biz)\b)/i.test(password);
  const asciiAllowed = [...password].every((character) => /[A-Za-z0-9]/.test(character) || PASSWORD_SPECIALS.includes(character));
  return {
    length: password.length >= 8 && password.length <= 16,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    special: [...password].some((character) => PASSWORD_SPECIALS.includes(character)),
    safeCharacters: password.length > 0 && asciiAllowed && !/\s/.test(password) && !urlLike,
    repeatedDigits: password.length > 0 && !/(\d)\1{3,}/.test(password),
  };
}

export function isValidMasterPassword(password: string): boolean {
  return Object.values(getMasterPasswordRules(password)).every(Boolean);
}

/** Pasted emoji/Unicode/whitespace are removed immediately from password fields. */
export function sanitizeMasterPasswordInput(value: string): string {
  return [...value].filter((character) => /[A-Za-z0-9]/.test(character) || PASSWORD_SPECIALS.includes(character)).join("").slice(0, 16);
}

export function isValidLuhn(value: string): boolean {
  const digits = normalizeCardNumber(value);
  if (digits.length < 12 || digits.length > 19) return false;
  // Common placeholder / obviously fabricated sequences are not plausible payment-card numbers.
  if (/^(\d)\1+$/.test(digits)) return false;
  if ([...digits].every((digit, index) => index === 0 || Number(digit) === (Number(digits[index - 1]) + 1) % 10)) return false;
  if ([...digits].every((digit, index) => index === 0 || Number(digit) === (Number(digits[index - 1]) + 9) % 10)) return false;
  let sum = 0;
  let doubleNext = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleNext) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleNext = !doubleNext;
  }
  return sum % 10 === 0;
}

export function detectNetwork(value: string): string {
  const digits = normalizeCardNumber(value);
  if (/^4/.test(digits)) return "VISA";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digits)) return "MASTERCARD";
  if (/^3[47]/.test(digits)) return "AMEX";
  if (/^(6011|65|64[4-9])/.test(digits)) return "DISCOVER";
  return "CARD";
}

export function validateCardForm(input: {
  name: string;
  holder: string;
  bank: string;
  number: string;
  expiry: string;
  tagsText: string;
  category?: CardCategory;
}): string | null {
  if (!input.name.trim()) return "cardName";
  if (!input.holder.trim()) return "cardHolder";
  if (!input.bank.trim()) return "bankName";
  const number = normalizeCardNumber(input.number);
  if (!number) return "cardNumberRequired";
  if (number.length < 12 || number.length > 19) return "invalidCardNumberLength";
  // Gift-card providers do not consistently use the payment-card checksum. Bank, credit and
  // virtual payment cards must pass Luhn; all groups still require a plausible numeric length.
  if (input.category !== "gift" && !isValidLuhn(number)) return "invalidCardNumber";
  if (input.expiry) {
    const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(input.expiry);
    if (!match) return "invalidExpiry";
    const month = Number(match[1]);
    const year = 2000 + Number(match[2]);
    const now = new Date();
    const expiryDate = new Date(year, month, 0, 23, 59, 59);
    if (expiryDate < new Date(now.getFullYear(), now.getMonth(), 1)) return "expiredCard";
  }
  if (input.tagsText.split(",").filter((tag) => tag.trim()).length > 10) return "tooManyTags";
  return null;
}

export function formatCardNumber(value: string, reveal = false): string {
  const digits = normalizeCardNumber(value);
  if (!digits) return "•••• •••• •••• ••••";
  if (!reveal) return `•••• •••• •••• ${digits.slice(-4)}`;
  return digits.match(/.{1,4}/g)?.join(" ") ?? digits;
}

export function getLastFour(value: string): string {
  return normalizeCardNumber(value).slice(-4).padStart(4, "•");
}

export function cardCategoryLabel(category: CardCategory): string {
  return ({ debit: "Debit", credit: "Credit", virtual: "Virtual", gift: "Gift" })[category];
}

export function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function sanitizeTags(value: string): string[] {
  return [...new Set(value.split(",").map((tag) => tag.trim().replace(/[<>]/g, "").slice(0, 24)).filter(Boolean))].slice(0, 10);
}

export function filterTransactionsByPeriod<T extends { occurredAt: string }>(items: T[], period: string, now = Date.now()): T[] {
  const durations: Record<string, number> = {
    "1h": 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
    "1w": 7 * 24 * 60 * 60 * 1000,
    "1m": 30 * 24 * 60 * 60 * 1000,
    "3m": 90 * 24 * 60 * 60 * 1000,
    "6m": 180 * 24 * 60 * 60 * 1000,
    "1y": 365 * 24 * 60 * 60 * 1000,
    "2y": 730 * 24 * 60 * 60 * 1000,
    "3y": 1095 * 24 * 60 * 60 * 1000,
  };
  const duration = durations[period] ?? durations["1m"];
  return items.filter((item) => {
    const timestamp = new Date(item.occurredAt).getTime();
    return Number.isFinite(timestamp) && timestamp >= now - duration && timestamp <= now;
  });
}

export function isUsableCard(value: unknown): value is VaultCard {
  if (!value || typeof value !== "object") return false;
  const card = value as Partial<VaultCard>;
  return typeof card.id === "string" && typeof card.name === "string" && typeof card.holder === "string" &&
    typeof card.category === "string" && CARD_CATEGORIES.includes(card.category as CardCategory) &&
    typeof card.number === "string" && typeof card.expiry === "string" && Array.isArray(card.tags);
}

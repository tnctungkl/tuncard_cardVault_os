"use client";

import { Button } from "@heroui/react";
import {
  Activity, ArrowDownLeft, ArrowDownToLine, ArrowLeftRight, ArrowRight, ArrowUpRight,
  BadgeCheck, Banknote, BarChart3, Check, CheckCircle2, ChevronDown,
  ChevronRight, CircleHelp, Clock3, CreditCard, Copy, Download, Eye, EyeOff, FileKey2,
  FileText, Filter, Gift, Globe2, Heart, KeyRound, Landmark, Lock, LockKeyhole,
  Menu, Moon, Pencil, Plus, Search, Shield, ShieldCheck, Sparkles, Sun, Tag, Trash2, Wallet, X, Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode, type RefObject } from "react";
import {
  createEncryptedVault, extractRecoveryCodeFromText, parseEncryptedVault, rewrapVaultPassword,
  unlockEncryptedVault, unlockEncryptedVaultWithRecovery, updateEncryptedVault,
  VAULT_STORAGE_KEY,
} from "@/lib/crypto";
import { translate } from "@/lib/i18n";
import type {
  CardAccent, CardCategory, EncryptedVaultRecord, Language, LedgerTransaction,
  NavigationSection, PendingAction, Theme, TransactionKind, VaultCard, VaultData,
} from "@/lib/types";
import {
  CARD_ACCENTS, CARD_CATEGORIES, detectNetwork, filterTransactionsByPeriod,
  formatCardNumber, formatCardNumberInput, getMasterPasswordRules, isValidMasterPassword,
  makeId, normalizeCardNumber, sanitizeMasterPasswordInput, sanitizeTags, validateCardForm,
} from "@/lib/validation";

const EMPTY_VAULT: VaultData = { schemaVersion: 1, cards: [], transactions: [] };
const IDLE_LOCK_MS = 10 * 60 * 1000;

type Notice = { type: "success" | "error" | "info"; text: string };
type DialogState =
  | { kind: "card-form"; cardId?: string }
  | { kind: "transaction-form" }
  | { kind: "confirm"; action: PendingAction }
  | { kind: "password-change" }
  | { kind: "restore-confirm"; record: EncryptedVaultRecord }
  | { kind: "clear-history-confirm" }
  | null;
type CardFormValues = Omit<VaultCard, "id" | "createdAt" | "updatedAt">;

function TkFingerprintLogo({ size = 23, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 2a10 10 0 0 0-8 8c0 3 1 6 3 8" />
      <path d="M12 5a7 7 0 0 0-5 6c0 3.5 1 6.5 2 8" />
      <path d="M8 11.5a4 4 0 0 1 4-3.5" />
      <path d="M12 12v6" />
      <path d="M9.5 15c0 2 1 3.5 2.5 4" />
      <path d="M15 19c1.5-1 2.5-3 2.5-5" />
      <path d="M14 6.5h4" strokeWidth="2" opacity="0.9" />
      <path d="M16 6.5v4.5" strokeWidth="2" opacity="0.95" />
      <path d="M19 11.5v6" strokeWidth="2" opacity="0.95" />
      <path d="M21.5 12.5L19 14.8l2.5 3.2" strokeWidth="1.8" opacity="0.9" />
    </svg>
  );
}

const categoryIcons: Record<CardCategory, typeof CreditCard> = { debit: Landmark, credit: CreditCard, virtual: Zap, gift: Gift };
const periodKeys = ["1h", "1d", "1w", "1m", "3m", "6m", "1y", "2y", "3y"] as const;
const periodLabels = {
  "1h": "lastHour", "1d": "lastDay", "1w": "lastWeek", "1m": "lastMonth",
  "3m": "last3Months", "6m": "last6Months", "1y": "lastYear", "2y": "last2Years", "3y": "last3Years",
} as const;
const transactionKinds: TransactionKind[] = ["payment", "topup", "withdrawal", "refund"];

function localDateTimeValue(date = new Date()): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatMoney(value: number, language: Language): string {
  return new Intl.NumberFormat(language === "tr" ? "tr-TR" : "en-GB", {
    style: "currency", currency: "TRY", maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string, language: Language, withTime = false): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language === "tr" ? "tr-TR" : "en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function categoryLabel(category: CardCategory, language: Language): string {
  return translate(language, category);
}

function transactionLabel(kind: TransactionKind, language: Language): string {
  return translate(language, kind);
}

function txIcon(kind: TransactionKind) {
  if (kind === "payment") return ArrowUpRight;
  if (kind === "topup") return ArrowDownToLine;
  if (kind === "withdrawal") return ArrowUpRight;
  return ArrowDownLeft;
}

export function VaultApp() {
  const [language, setLanguage] = useState<Language>("en");
  const [theme, setTheme] = useState<Theme>("dark");
  const [hasVault, setHasVault] = useState<boolean | null>(null);
  const [vaultRecord, setVaultRecord] = useState<EncryptedVaultRecord | null>(null);
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const [vaultData, setVaultData] = useState<VaultData | null>(null);
  const [passphraseError, setPassphraseError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [recoveryCodeToShow, setRecoveryCodeToShow] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<NavigationSection>("overview");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CardCategory | "all">("all");
  const [transactionPeriod, setTransactionPeriod] = useState<(typeof periodKeys)[number]>("1m");
  const [transactionKindFilter, setTransactionKindFilter] = useState<TransactionKind | "all">("all");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [flippedCards, setFlippedCards] = useState<Set<string>>(() => new Set());
  const lastActivityRef = useRef(Date.now());
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const recoveryInputRef = useRef<HTMLInputElement | null>(null);

  const t = useCallback((key: Parameters<typeof translate>[1]) => translate(language, key), [language]);
  const isUnlocked = Boolean(vaultKey && vaultRecord && vaultData);

  useEffect(() => { document.documentElement.lang = language === "tr" ? "tr" : "en"; }, [language]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VAULT_STORAGE_KEY);
      if (!raw) setHasVault(false);
      else { setVaultRecord(parseEncryptedVault(raw)); setHasVault(true); }
    } catch {
      setHasVault(true);
      setPassphraseError(t("integrityError"));
    }
  }, []);

  const lockVault = useCallback(() => {
    setVaultKey(null); setVaultData(null); setDialog(null); setSearchTerm("");
    setFlippedCards(new Set()); setPassphraseError(""); setNotice(null);
  }, []);

  useEffect(() => {
    if (!vaultKey) return;
    lastActivityRef.current = Date.now();
    const touch = () => { lastActivityRef.current = Date.now(); };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "mousemove", "touchstart", "scroll"];
    events.forEach((eventName) => window.addEventListener(eventName, touch, { passive: true }));
    const timer = window.setInterval(() => { if (Date.now() - lastActivityRef.current >= IDLE_LOCK_MS) lockVault(); }, 15_000);
    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, touch));
      window.clearInterval(timer);
    };
  }, [vaultKey, lockVault]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4_500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const saveVaultData = useCallback(async (nextData: VaultData) => {
    if (!vaultKey || !vaultRecord) throw new Error("The vault is locked.");
    const encrypted = await updateEncryptedVault(nextData, vaultKey, vaultRecord);
    window.localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(encrypted));
    setVaultRecord(encrypted);
    setVaultData(nextData);
  }, [vaultKey, vaultRecord]);

  const createVault = async (password: string, confirmPassword: string) => {
    setPassphraseError("");
    if (!isValidMasterPassword(password)) { setPassphraseError(t("passwordRulesInvalid")); return; }
    if (password !== confirmPassword) { setPassphraseError(t("passwordMismatch")); return; }
    try {
      const { record, key, recoveryCode } = await createEncryptedVault(password, EMPTY_VAULT);
      window.localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(record));
      setVaultRecord(record); setVaultKey(key); setVaultData(EMPTY_VAULT); setHasVault(true);
      setRecoveryCodeToShow(recoveryCode); setPassphraseError("");
      setNotice({ type: "success", text: t("allGood") });
    } catch (error) {
      setPassphraseError(error instanceof Error ? error.message : t("storageUnavailable"));
    }
  };

  const unlockVault = async (password: string) => {
    setPassphraseError("");
    try {
      const raw = window.localStorage.getItem(VAULT_STORAGE_KEY);
      if (!raw) { setHasVault(false); setPassphraseError(t("integrityError")); return; }
      const record = parseEncryptedVault(raw);
      const result = await unlockEncryptedVault(password, record);
      if (result.legacy) {
        const migrated = await createEncryptedVault(password, result.data);
        window.localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(migrated.record));
        setVaultRecord(migrated.record); setVaultData(result.data); setVaultKey(migrated.key);
        setRecoveryCodeToShow(migrated.recoveryCode);
      } else {
        setVaultRecord(record); setVaultData(result.data); setVaultKey(result.key);
      }
      setPassphraseError("");
    } catch (error) {
      setPassphraseError(error instanceof Error ? error.message : t("unlockError"));
    }
  };

  const unlockVaultWithRecovery = async (recoveryCode: string) => {
    setPassphraseError("");
    try {
      const raw = window.localStorage.getItem(VAULT_STORAGE_KEY);
      if (!raw) { setHasVault(false); setPassphraseError(t("integrityError")); return; }
      const record = parseEncryptedVault(raw);
      if (record.format !== "cardvault-encrypted-v2") throw new Error(t("recoveryInvalid"));
      const result = await unlockEncryptedVaultWithRecovery(recoveryCode, record);
      setVaultRecord(record); setVaultData(result.data); setVaultKey(result.key);
      setPassphraseError("");
      setNotice({ type: "success", text: t("recoveryUnlocked") });
    } catch {
      setPassphraseError(t("recoveryInvalid"));
    }
  };

  const selectRecoveryFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      if (file.size > 20_000) throw new Error("Recovery file is too large.");
      const code = extractRecoveryCodeFromText(await file.text());
      if (!code) throw new Error("No valid recovery key was found.");
      await unlockVaultWithRecovery(code);
    } catch {
      setPassphraseError(t("recoveryInvalid"));
    }
  };

  const confirmPendingAction = async () => {
    if (!dialog || dialog.kind !== "confirm" || !vaultData) return;
    const { action } = dialog;
    try {
      if (action.kind === "save-card") {
        const cards = action.wasEditing
          ? vaultData.cards.map((card) => card.id === action.card.id ? action.card : card)
          : [...vaultData.cards, action.card];
        await saveVaultData({ ...vaultData, cards });
        setNotice({ type: "success", text: t(action.wasEditing ? "cardUpdated" : "cardSaved") });
      } else {
        const cards = vaultData.cards.filter((card) => card.id !== action.cardId);
        const transactions = vaultData.transactions;
        await saveVaultData({ ...vaultData, cards, transactions });
        setFlippedCards((previous) => { const next = new Set(previous); next.delete(action.cardId); return next; });
        setNotice({ type: "success", text: t("cardDeleted") });
      }
      setDialog(null);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : t("storageUnavailable") });
    }
  };

  const toggleFavorite = async (cardId: string) => {
    if (!vaultData) return;
    const cards = vaultData.cards.map((card) => card.id === cardId ? { ...card, favorite: !card.favorite, updatedAt: new Date().toISOString() } : card);
    try { await saveVaultData({ ...vaultData, cards }); }
    catch (error) { setNotice({ type: "error", text: error instanceof Error ? error.message : t("storageUnavailable") }); }
  };

  const handleEmbeddedTransactionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!vaultData) return;
    const form = new FormData(event.currentTarget);
    const cardId = String(form.get("cardId") ?? "");
    const card = vaultData.cards.find((item) => item.id === cardId);
    const description = String(form.get("description") ?? "").trim();
    const amount = Number(form.get("amount"));
    const kind = String(form.get("kind") ?? "payment") as TransactionKind;
    const occurredAtRaw = String(form.get("occurredAt") ?? "");
    const occurredAtDate = new Date(occurredAtRaw);
    if (!card || !description || !Number.isFinite(amount) || amount <= 0 || !transactionKinds.includes(kind) || !Number.isFinite(occurredAtDate.getTime())) {
      setNotice({ type: "error", text: t("transactionRequired") });
      return;
    }
    const occurredAt = occurredAtDate.toISOString();
    const transaction: LedgerTransaction = {
      id: makeId(), cardId, cardLabel: card.name, kind,
      description: description.slice(0, 80), amount: Math.round(amount * 100) / 100,
      currency: "TRY", occurredAt,
      note: String(form.get("note") ?? "").trim().slice(0, 500),
    };
    try {
      await saveVaultData({ ...vaultData, transactions: [transaction, ...vaultData.transactions] });
      event.currentTarget.reset();
      setNotice({ type: "success", text: t("transactionSaved") });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : t("storageUnavailable") });
    }
  };

  const changeMasterPassphrase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!vaultRecord || !vaultData) return;
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (!isValidMasterPassword(newPassword)) { setNotice({ type: "error", text: t("passwordRulesInvalid") }); return; }
    if (newPassword !== confirmPassword) { setNotice({ type: "error", text: t("passwordMismatch") }); return; }
    try {
      const existing = await unlockEncryptedVault(currentPassword, vaultRecord);
      if (existing.legacy) throw new Error("Unlock this legacy vault again to finish its security migration.");
      const updatedRecord = await rewrapVaultPassword(existing.key, newPassword, vaultRecord);
      window.localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(updatedRecord));
      setVaultRecord(updatedRecord); setVaultKey(existing.key); setVaultData(existing.data);
      setDialog(null);
      setNotice({ type: "success", text: t("passwordChanged") });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error && error.message.includes("incorrect") ? t("currentPasswordWrong") : t("storageUnavailable") });
    }
  };

  const exportBackup = () => {
    if (!vaultRecord) return;
    const blob = new Blob([JSON.stringify(vaultRecord, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tuncard-encrypted-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setNotice({ type: "success", text: t("backupExported") });
  };

  const selectBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Backup is larger than 10 MB.");
      const record = parseEncryptedVault(await file.text());
      setDialog({ kind: "restore-confirm", record });
    } catch {
      if (isUnlocked) setNotice({ type: "error", text: t("backupInvalid") });
      else setPassphraseError(t("backupInvalid"));
    }
  };

  const restoreBackup = () => {
    if (!dialog || dialog.kind !== "restore-confirm") return;
    try {
      window.localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(dialog.record));
      setVaultRecord(dialog.record); setHasVault(true); setVaultKey(null); setVaultData(null);
      setDialog(null); setPassphraseError("");
      setNotice({ type: "success", text: t("backupRestored") });
    } catch {
      setNotice({ type: "error", text: t("storageUnavailable") });
    }
  };

  const confirmClearHistory = async () => {
    if (!vaultData || dialog?.kind !== "clear-history-confirm") return;
    try {
      await saveVaultData({ ...vaultData, transactions: [] });
      setDialog(null);
      setNotice({ type: "success", text: t("historyCleared") });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : t("storageUnavailable") });
    }
  };

  const cards = useMemo(() => {
    if (!vaultData) return [];
    return [...vaultData.cards].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt.localeCompare(a.updatedAt));
  }, [vaultData]);

  const filteredCards = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-GB");
    return cards.filter((card) => {
      const matchesCategory = categoryFilter === "all" || card.category === categoryFilter;
      const matchesSearch = !query || [card.name, card.holder, card.bank, ...card.tags].some((value) => value.toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-GB").includes(query));
      return matchesCategory && matchesSearch;
    });
  }, [cards, categoryFilter, searchTerm, language]);

  const periodTransactions = useMemo(() => filterTransactionsByPeriod(vaultData?.transactions ?? [], transactionPeriod), [vaultData?.transactions, transactionPeriod]);
  const filteredTransactions = useMemo(() => {
    return [...periodTransactions]
      .filter((item) => transactionKindFilter === "all" || item.kind === transactionKindFilter)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }, [periodTransactions, transactionKindFilter]);
  const visibleVolume = filteredTransactions.reduce((sum, item) => sum + item.amount, 0);

  const navItems: Array<{ id: NavigationSection; label: string; icon: typeof Activity }> = [
    { id: "overview", label: t("overview"), icon: BarChart3 },
    { id: "cards", label: t("cards"), icon: CreditCard },
    { id: "activity", label: t("activity"), icon: Activity },
    { id: "security", label: t("security"), icon: ShieldCheck },
  ];

  if (hasVault === null) {
    return <div className="boot-screen"><div className="brand-mark"><TkFingerprintLogo size={23} /></div><p>{t("appLoading")}</p><div className="loading-rail" /></div>;
  }

  if (!isUnlocked) {
    return <VaultGate
      language={language} setLanguage={setLanguage} hasVault={hasVault}
      error={passphraseError} notice={notice} onCreate={createVault} onUnlock={unlockVault}
      onRestore={() => restoreInputRef.current?.click()}
      onBackupSelect={selectBackup} inputRef={restoreInputRef} restoreConfirmation={dialog?.kind === "restore-confirm"}
      onRecoveryOpen={() => recoveryInputRef.current?.click()} onRecoverySelect={selectRecoveryFile} recoveryInputRef={recoveryInputRef}
      onConfirmRestore={restoreBackup} onCancelRestore={() => setDialog(null)}
      theme={theme} setTheme={setTheme} t={t}
    />;
  }

  return (
    <div className={`app-shell theme-${theme} min-h-screen`} data-theme={theme}>
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><TkFingerprintLogo size={23} /></div>
          <div><div className="brand-name">TUNC<span>ARD</span><sup>®</sup></div><div className="brand-caption">CARD VAULT OS</div></div>
          <button className="icon-btn sidebar-close" aria-label={t("close")} onClick={() => setMobileNavOpen(false)}><X size={17} /></button>
        </div>
        <div className="workspace-pill"><span className="status-dot" /><span>{t("localOnly")}</span><span className="pill-lock"><Lock size={11} /></span></div>
        <div className="side-label">WORKSPACE <span>01</span></div>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map((item, index) => {
            const Icon = item.icon;
            return <button key={item.id} className={`nav-item ${activeSection === item.id ? "nav-active" : ""}`} onClick={() => { setActiveSection(item.id); setMobileNavOpen(false); }}>
              <Icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{index === 1 && <span className="nav-count">{cards.length.toString().padStart(2, "0")}</span>}
            </button>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-mini"><div className="security-mini-icon"><ShieldCheck size={17} /></div><div><strong>{t("encrypted")}</strong><span>{t("encryptionMethod")}</span></div><CheckCircle2 size={15} className="mini-check" /></div>
          <button className="profile-row" onClick={lockVault}><div className="profile-avatar">TC</div><div className="profile-copy"><strong>Tuncard Workspace</strong><span>{t("secureSession")}</span></div><LockKeyhole size={16} /></button>
          <div className="sidebar-footnote"><span>TUNCARD / 1.1.0</span><span><span className="status-dot" /> ONLINE</span></div>
        </div>
      </aside>

      <main className="main-area flex flex-col">
        <header className="topbar">
          <div className="breadcrumb"><button className="mobile-menu icon-btn" aria-label="Menu" onClick={() => setMobileNavOpen(true)}><Menu size={19} /></button><span>WORKSPACE</span><ChevronRight size={13} /><strong>{navItems.find((item) => item.id === activeSection)?.label}</strong></div>
          <div className="top-actions">
            <div className="language-switch" role="group" aria-label={t("language")}>
              <button className={`language-en ${language === "en" ? "selected" : ""}`} onClick={() => setLanguage("en")} title="English"><span className="flag-icon">🇬🇧 🇺🇸</span> ENGLISH</button>
              <button className={`language-tr ${language === "tr" ? "selected" : ""}`} onClick={() => setLanguage("tr")} title="Türkçe"><span className="flag-icon">🇹🇷</span> TÜRKÇE</button>
            </div>
            <button className="theme-toggle" aria-label={theme === "dark" ? t("lightMode") : t("darkMode")} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}<span>{theme === "dark" ? t("darkMode") : t("lightMode")}</span></button>
            <span className="top-separator" />
            <div className="session-chip"><span className="session-pulse" /><span>LOCAL SESSION</span></div>
            <button className="icon-btn lock-action" aria-label={t("lock")} title={t("lock")} onClick={lockVault}><LockKeyhole size={17} /></button>
          </div>
        </header>

        <div className="page-content">
          {activeSection === "overview" && <OverviewSection
            t={t} language={language} cards={cards} allTransactions={vaultData!.transactions}
            period={transactionPeriod} setPeriod={setTransactionPeriod}
            setActiveSection={setActiveSection}
            onClearHistory={() => setDialog({ kind: "clear-history-confirm" })}
            setNotice={setNotice}
          />}
          {activeSection === "cards" && <CardsSection
            t={t} language={language} cards={filteredCards} allCards={cards} allCount={cards.length}
            categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} searchTerm={searchTerm} setSearchTerm={setSearchTerm}
            onAddCard={() => setDialog({ kind: "card-form" })} onEdit={(id) => setDialog({ kind: "card-form", cardId: id })}
            onDelete={(id) => setDialog({ kind: "confirm", action: { kind: "delete-card", cardId: id } })}
            onFavorite={toggleFavorite} flippedCards={flippedCards} setFlippedCards={setFlippedCards}
          />}
          {activeSection === "activity" && <ActivitySection
            t={t} language={language} transactions={filteredTransactions} allPeriodTransactions={periodTransactions}
            totalVolume={visibleVolume} period={transactionPeriod} setPeriod={setTransactionPeriod}
            kindFilter={transactionKindFilter} setKindFilter={setTransactionKindFilter}
            cards={cards} historyCount={vaultData!.transactions.length}
            onClearHistory={() => setDialog({ kind: "clear-history-confirm" })}
            onAddCard={() => setDialog({ kind: "card-form" })}
            onAddTransaction={handleEmbeddedTransactionSubmit}
            setNotice={setNotice}
          />}
          {activeSection === "security" && <SecuritySection
            t={t} language={language} theme={theme} setTheme={setTheme} onLock={lockVault}
            onExport={exportBackup} onRestore={() => restoreInputRef.current?.click()}
            onChangePassword={() => setDialog({ kind: "password-change" })} cardCount={cards.length} transactionCount={vaultData!.transactions.length} setLanguage={setLanguage}
          />}
        </div>
        <footer className="app-footer"><span>© {new Date().getFullYear()} TUNCARD STUDIO</span><span><Lock size={11} /> ENCRYPTED LOCALLY <i /> CARD VAULT SECURITY</span></footer>
      </main>

      <input ref={restoreInputRef} type="file" accept="application/json,.json" className="visually-hidden" onChange={selectBackup} aria-label={t("restoreBackup")} />
      <input ref={recoveryInputRef} type="file" accept="text/plain,.txt" className="visually-hidden" onChange={selectRecoveryFile} aria-label={t("recoverySelectFile")} />

      {notice && <div className={`toast toast-${notice.type}`} role="status"><span className="toast-icon">{notice.type === "success" ? <CheckCircle2 size={17} /> : notice.type === "error" ? <CircleHelp size={17} /> : <Sparkles size={17} />}</span><span>{notice.text}</span><button aria-label={t("close")} onClick={() => setNotice(null)}><X size={15} /></button></div>}

      {dialog?.kind === "card-form" && <CardFormDialog
        t={t} language={language} card={dialog.cardId ? cards.find((item) => item.id === dialog.cardId) : undefined}
        onClose={() => setDialog(null)} onSubmit={(values, wasEditing) => {
          const existing = values.id ? cards.find((card) => card.id === values.id) : undefined;
          const card: VaultCard = { ...values, id: existing?.id ?? makeId(), createdAt: existing?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
          setDialog({ kind: "confirm", action: { kind: "save-card", card, wasEditing } });
        }}
      />}
      {dialog?.kind === "transaction-form" && <TransactionFormDialog t={t} language={language} cards={cards} onClose={() => setDialog(null)} onSubmit={handleEmbeddedTransactionSubmit} />}
      {dialog?.kind === "confirm" && <ConfirmDialog
        t={t} language={language} action={dialog.action} card={cards.find((item) => item.id === (dialog.action.kind === "delete-card" ? dialog.action.cardId : dialog.action.card.id))}
        onClose={() => setDialog(null)} onConfirm={confirmPendingAction}
      />}
      {dialog?.kind === "password-change" && <PasswordChangeDialog t={t} onClose={() => setDialog(null)} onSubmit={changeMasterPassphrase} />}
      {dialog?.kind === "restore-confirm" && <ConfirmRestoreDialog t={t} onClose={() => setDialog(null)} onConfirm={restoreBackup} />}
      {dialog?.kind === "clear-history-confirm" && <ConfirmClearHistoryDialog t={t} onClose={() => setDialog(null)} onConfirm={confirmClearHistory} />}
      {recoveryCodeToShow && <RecoveryKeyDialog t={t} recoveryCode={recoveryCodeToShow} onClose={() => setRecoveryCodeToShow(null)} />}
    </div>
  );
}

function VaultGate({
  language, setLanguage, hasVault, error, notice, onCreate, onUnlock, onRestore, onBackupSelect, inputRef, restoreConfirmation,
  onRecoveryOpen, onRecoverySelect, recoveryInputRef, onConfirmRestore, onCancelRestore, theme, setTheme, t,
}: {
  language: Language; setLanguage: (language: Language) => void; hasVault: boolean; error: string; notice: Notice | null;
  onCreate: (password: string, confirmPassword: string) => Promise<void>; onUnlock: (password: string) => Promise<void>;
  onRestore: () => void; onBackupSelect: (event: ChangeEvent<HTMLInputElement>) => void; inputRef: RefObject<HTMLInputElement | null>;
  onRecoveryOpen: () => void; onRecoverySelect: (event: ChangeEvent<HTMLInputElement>) => void; recoveryInputRef: RefObject<HTMLInputElement | null>;
  restoreConfirmation: boolean; onConfirmRestore: () => void; onCancelRestore: () => void;
  theme: Theme; setTheme: (theme: Theme) => void; t: (key: Parameters<typeof translate>[1]) => string;
}) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [revealPassword, setRevealPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const canCreate = isValidMasterPassword(password) && password === confirmPassword;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSubmitting(true);
    try { if (hasVault) await onUnlock(password); else await onCreate(password, confirmPassword); }
    finally { setSubmitting(false); }
  };
  return (
    <div className={`gate-screen theme-${theme} min-h-screen flex flex-col`} data-theme={theme}>
      <div className="matrix-rain" aria-hidden="true">{Array.from({ length: 29 }, (_, index) => {
        const alphabet = "01ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%@";
        const glyphs = Array.from({ length: 18 }, (_, glyphIndex) => {
          const seed = (index * 73 + glyphIndex * 37 + index * glyphIndex * 11 + glyphIndex * glyphIndex * 17) % alphabet.length;
          return alphabet[seed];
        }).join("\n");
        return <span key={index} style={{ left: `${(index * 37) % 100}%`, animationDelay: `${-(index % 11) * 1.7}s`, animationDuration: `${12 + (index % 7) * 2.1}s`, opacity: 0.08 + (index % 4) * 0.035 }}>{glyphs}</span>;
      })}</div>
      <div className="gate-grid" /><div className="gate-orbit orbit-a" /><div className="gate-orbit orbit-b" />
      <header className="gate-topbar">
        <div className="brand-lockup"><div className="brand-mark"><TkFingerprintLogo size={22} /></div><div><div className="brand-name">TUNC<span>ARD</span><sup>®</sup></div><div className="brand-caption">CARD VAULT OS</div></div></div>
        <div className="gate-controls">
          <div className="language-switch" role="group" aria-label={t("language")}>
            <button className={`language-en ${language === "en" ? "selected" : ""}`} onClick={() => setLanguage("en")} title="English"><span className="flag-icon">🇬🇧 🇺🇸</span> ENGLISH</button>
            <button className={`language-tr ${language === "tr" ? "selected" : ""}`} onClick={() => setLanguage("tr")} title="Türkçe"><span className="flag-icon">🇹🇷</span> TÜRKÇE</button>
          </div>
          <button className="gate-theme icon-btn" aria-label={t("theme")} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
        </div>
      </header>
      <div className="gate-layout">
        <section className="gate-story">
          <div className="eyebrow"><span className="eyebrow-line" /> {t("localOnly")} <span className="eyebrow-dot">●</span></div>
          <h1>{language === "en" ? <>Your cards.<br /><span>Your rules.</span></> : <>Kartların.<br /><span>Kontrol sende.</span></>}</h1>
          <p className="gate-subtitle">{t("vaultIntro")}</p>
          <div className="gate-feature-list">
            <div><span className="feature-icon"><ShieldCheck size={17} /></span><span><strong>AES-GCM 256-bit</strong><small>{t("encryptionDescription")}</small></span></div>
            <div><span className="feature-icon"><TkFingerprintLogo size={17} /></span><span><strong>{language === "en" ? "You hold the key" : "Anahtar sende"}</strong><small>{t("noPassphraseRecovery")}</small></span></div>
            <div><span className="feature-icon"><Zap size={17} /></span><span><strong>{language === "en" ? "Local by design" : "Tasarım gereği yerel"}</strong><small>{t("privacyLine")}</small></span></div>
          </div>
          <div className="gate-signal"><span className="signal-wave" /><span>{t("localCryptoStatus")}</span><span className="signal-state">{t("readyStatus")}</span></div>
        </section>
        <section className="gate-card-wrap">
          <div className="gate-card-topline"><span className="secure-badge"><LockKeyhole size={13} /> {hasVault ? t("lockedSessionLabel") : t("newLocalVaultLabel")}</span><span className="gate-serial">TC-01 / 256</span></div>
          <div className="gate-card-icon"><div className="vault-ring ring-one" /><div className="vault-ring ring-two" /><div className="vault-center"><TkFingerprintLogo size={35} /></div><div className="orbit-point point-one" /><div className="orbit-point point-two" /></div>
          <div className="gate-card-heading"><div className="gate-card-kicker">{hasVault ? t("identityVerification") : t("privateWorkspaceSetup")}</div><h2>{hasVault ? t("welcomeBack") : t("createVault")}</h2><p>{hasVault ? t("lockedDescription") : t("passphraseHint")}</p></div>
          <form className="gate-form" onSubmit={submit}>
            <label htmlFor="master-pass">{t("masterPassphrase")}</label>
            <div className="password-field"><KeyRound size={17} /><input id="master-pass" name="password" type={revealPassword ? "text" : "password"} autoComplete={hasVault ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(hasVault ? event.target.value : sanitizeMasterPasswordInput(event.target.value))} maxLength={hasVault ? undefined : 16} required autoFocus /><button type="button" aria-label={revealPassword ? "Hide password" : "Show password"} onClick={() => setRevealPassword((value) => !value)}>{revealPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
            {!hasVault && <PasswordRules t={t} password={password} />}
            {!hasVault && <><label htmlFor="confirm-pass">{t("confirmPassphrase")}</label><div className="password-field"><KeyRound size={17} /><input id="confirm-pass" name="confirmPassword" type={revealPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(sanitizeMasterPasswordInput(event.target.value))} maxLength={16} required /></div>{confirmPassword && password !== confirmPassword && <div className="inline-error" role="alert"><CircleHelp size={14} /> {t("passwordMismatch")}</div>}</>}
            {error && <div className="inline-error" role="alert"><CircleHelp size={16} /> <span>{error}</span></div>}
            {!error && notice && <div className={notice.type === "success" ? "inline-success" : "inline-error"} role={notice.type === "error" ? "alert" : "status"}>{notice.type === "success" ? <CheckCircle2 size={16} /> : <CircleHelp size={16} />} <span>{notice.text}</span></div>}
            <Button type="submit" className="primary-btn gate-submit" variant="primary" isPending={submitting} isDisabled={submitting || (!hasVault && !canCreate)}>
              {hasVault ? t("unlock") : t("createAndUnlock")} <ArrowRight size={17} />
            </Button>
          </form>
          <div className="restore-row"><span>{t("backupDescription")}</span><div className="gate-recovery-actions"><button type="button" onClick={onRecoveryOpen}>{t("recoverySelectFile")} <ChevronRight size={14} /></button><button type="button" onClick={onRestore}>{t("restoreBackup")} <ChevronRight size={14} /></button></div></div>
          <div className="gate-card-foot"><span><span className="tiny-green" /> {t("secureSession")}</span><span>BUILD 01.1.0</span></div>
        </section>
      </div>
      <footer className="gate-footer"><span>© {new Date().getFullYear()} TUNCARD STUDIO</span><span><Shield size={13} /> {t("privacyLine")}</span><span>{t("encryptionFirst")} <i /> {t("humanControl")}</span></footer>
      <input ref={inputRef} type="file" accept="application/json,.json" className="visually-hidden" onChange={onBackupSelect} aria-label={t("restoreBackup")} />
      <input ref={recoveryInputRef} type="file" accept="text/plain,.txt" className="visually-hidden" onChange={onRecoverySelect} aria-label={t("recoverySelectFile")} />
      {restoreConfirmation && <ConfirmRestoreDialog t={t} onClose={onCancelRestore} onConfirm={onConfirmRestore} />}
    </div>
  );
}

function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}

/** Overview Section: Contains Full-Width Financial Activity Analytics (with CSV/PDF Analytics Report Buttons) & Recent Activity Stacked */
function OverviewSection({
  t, language, cards, allTransactions, period, setPeriod, setActiveSection, onClearHistory, setNotice,
}: {
  t: (key: Parameters<typeof translate>[1]) => string; language: Language; cards: VaultCard[];
  allTransactions: LedgerTransaction[]; period: (typeof periodKeys)[number]; setPeriod: (period: (typeof periodKeys)[number]) => void;
  setActiveSection: (section: NavigationSection) => void; onClearHistory: () => void;
  setNotice: (notice: Notice | null) => void;
}) {
  const favoriteCount = cards.filter((card) => card.favorite).length;
  const rangeItems = useMemo(() => filterTransactionsByPeriod(allTransactions, period), [allTransactions, period]);
  const volume = rangeItems.reduce((sum, transaction) => sum + transaction.amount, 0);
  const maxAmount = useMemo(() => {
    if (rangeItems.length === 0) return 1;
    return Math.max(...rangeItems.map(item => item.amount), 1);
  }, [rangeItems]);

  const [hoveredTx, setHoveredTx] = useState<LedgerTransaction | null>(null);

  const exportAnalyticsCsv = () => {
    if (rangeItems.length === 0) return;
    const headers = language === "tr" ? ["Tarih", "Islem Aciklamasi", "Bagli Kart", "Islem Turu", "Tutar (TRY)", "Not"] : ["Date", "Transaction Description", "Linked Card", "Kind", "Amount (TRY)", "Note"];
    const rows = rangeItems.map(item => [
      formatDate(item.occurredAt, language, true),
      `"${item.description.replace(/"/g, '""')}"`,
      `"${item.cardLabel.replace(/"/g, '""')}"`,
      transactionLabel(item.kind, language),
      item.amount,
      `"${(item.note || "").replace(/"/g, '""')}"`
    ]);
    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tuncard-financial-analytics-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice({ type: "success", text: language === "tr" ? "Analitik CSV Raporu başarıyla oluşturuldu." : "Analytics CSV report generated successfully." });
  };

  const exportAnalyticsPdf = () => {
    if (rangeItems.length === 0) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const inflowTotal = rangeItems.filter(i => i.kind === "topup" || i.kind === "refund").reduce((s, i) => s + i.amount, 0);
    const outflowTotal = rangeItems.filter(i => i.kind === "payment" || i.kind === "withdrawal").reduce((s, i) => s + i.amount, 0);

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="${language}">
      <head>
        <meta charset="utf-8">
        <title>Tuncard Financial Activity Analytics Report</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111; padding: 40px; margin: 0; background: #fff; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #00f2fe; padding-bottom: 20px; margin-bottom: 30px; }
          .brand { font-size: 24px; font-weight: 800; letter-spacing: 1px; color: #0b0f19; }
          .brand span { color: #00bcd4; }
          .meta { font-size: 13px; color: #555; text-align: right; }
          .summary-box { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 30px; }
          .card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px 20px; border-radius: 8px; }
          .card small { display: block; color: #64748b; font-size: 11px; text-transform: uppercase; margin-bottom: 5px; }
          .card strong { font-size: 16px; color: #0f172a; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
          th, td { padding: 12px 14px; text-align: left; border-bottom: 1px solid #e2e8f0; }
          th { background: #f1f5f9; color: #334155; font-weight: 700; text-transform: uppercase; font-size: 11px; }
          .pos { color: #10b981; font-weight: 600; }
          .neg { color: #f43f5e; font-weight: 600; }
          .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">TUNC<span>ARD</span></div>
            <div style="font-size: 12px; color: #64748b; margin-top: 3px;">FINANCIAL ACTIVITY ANALYTICS STATEMENT</div>
          </div>
          <div class="meta">
            <div><strong>${language === "tr" ? "Analiz Dönemi" : "Analytics Period"}:</strong> ${t(periodLabels[period])}</div>
            <div><strong>${language === "tr" ? "Rapor Tarihi" : "Generated At"}:</strong> ${new Date().toLocaleString()}</div>
          </div>
        </div>

        <div class="summary-box">
          <div class="card"><small>${language === "tr" ? "Toplam İşlem" : "Total Transactions"}</small><strong>${rangeItems.length}</strong></div>
          <div class="card"><small>${language === "tr" ? "Dönem Hacmi" : "Period Volume"}</small><strong>${formatMoney(volume, language)}</strong></div>
          <div class="card"><small>${language === "tr" ? "Toplam Giriş (Inflow)" : "Total Inflows"}</small><strong style="color:#10b981;">+${formatMoney(inflowTotal, language)}</strong></div>
          <div class="card"><small>${language === "tr" ? "Toplam Çıkış (Outflow)" : "Total Outflows"}</small><strong style="color:#f43f5e;">−${formatMoney(outflowTotal, language)}</strong></div>
        </div>

        <h3 style="margin-bottom: 10px; font-size: 16px; color: #1e293b;">${language === "tr" ? "Dönemsel Grafik Döküm Listesi" : "Timeframe Chart Breakdown Ledger"}</h3>
        <table>
          <thead>
            <tr>
              <th>${language === "tr" ? "Tarih & Saat" : "Date & Time"}</th>
              <th>${language === "tr" ? "Açıklama / Merchant" : "Description / Merchant"}</th>
              <th>${language === "tr" ? "İlişkili Kart" : "Linked Card"}</th>
              <th>${language === "tr" ? "Akış Türü" : "Flow Type"}</th>
              <th style="text-align: right;">${language === "tr" ? "Tutar" : "Amount"}</th>
            </tr>
          </thead>
          <tbody>
            ${rangeItems.map(tx => {
              const positive = tx.kind === "topup" || tx.kind === "refund";
              return `
                <tr>
                  <td>${formatDate(tx.occurredAt, language, true)}</td>
                  <td><strong>${tx.description}</strong></td>
                  <td>${tx.cardLabel}</td>
                  <td>${transactionLabel(tx.kind, language)}</td>
                  <td style="text-align: right;" class="${positive ? 'pos' : 'neg'}">${positive ? '+' : '−'}${formatMoney(tx.amount, language)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>

        <div class="footer">
          Tuncard Vault OS · Professional Analytics Engine · Confidential Cash Flow Report.
        </div>
        <script>
          window.onload = function() { window.print(); };
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    setNotice({ type: "success", text: language === "tr" ? "Analitik PDF Raporu başarıyla oluşturuldu." : "Analytics PDF report generated successfully." });
  };

  return <>
    <PageHeading
      eyebrow="TUNCARD FINANCE / 01"
      title={t("dashboardTitle")}
      subtitle={t("dashboardSub")}
      action={
        <div className="flex gap-3">
          {/* Overview CSV Report Button with Neon Green Glass Hover */}
          <button
            onClick={exportAnalyticsCsv}
            disabled={rangeItems.length === 0}
            className="neon-csv-btn flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "rgba(16, 185, 129, 0.08)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              color: "#34d399",
              backdropFilter: "blur(8px)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(16, 185, 129, 0.25)";
              e.currentTarget.style.borderColor = "#10b981";
              e.currentTarget.style.boxShadow = "0 0 20px rgba(16, 185, 129, 0.4)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(16, 185, 129, 0.08)";
              e.currentTarget.style.borderColor = "rgba(16, 185, 129, 0.3)";
              e.currentTarget.style.boxShadow = "none";
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.background = "#065f46";
              e.currentTarget.style.color = "#ffffff";
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.background = "rgba(16, 185, 129, 0.25)";
              e.currentTarget.style.color = "#34d399";
            }}
          >
            <Download size={15} /> {t("downloadCsvReport")}
          </button>

          {/* Overview PDF Report Button with Neon Red Glass Hover */}
          <button
            onClick={exportAnalyticsPdf}
            disabled={rangeItems.length === 0}
            className="neon-pdf-btn flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "rgba(244, 63, 94, 0.08)",
              border: "1px solid rgba(244, 63, 94, 0.3)",
              color: "#fb7185",
              backdropFilter: "blur(8px)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(244, 63, 94, 0.25)";
              e.currentTarget.style.borderColor = "#f43f5e";
              e.currentTarget.style.boxShadow = "0 0 20px rgba(244, 63, 94, 0.4)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(244, 63, 94, 0.08)";
              e.currentTarget.style.borderColor = "rgba(244, 63, 94, 0.3)";
              e.currentTarget.style.boxShadow = "none";
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.background = "#9f1239";
              e.currentTarget.style.color = "#ffffff";
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.background = "rgba(244, 63, 94, 0.25)";
              e.currentTarget.style.color = "#fb7185";
            }}
          >
            <FileText size={15} /> {t("downloadPdfReport")}
          </button>
        </div>
      }
    />
    <div className="metric-grid">
      <MetricCard label={t("totalCards")} value={String(cards.length).padStart(2, "0")} icon={<CreditCard size={18} />} accent="violet" footer={t("localOnly")} />
      <MetricCard label={t("favorites")} value={String(favoriteCount).padStart(2, "0")} icon={<Heart size={18} />} accent="rose" footer={language === "en" ? "Pinned for quick access" : "Hızlı erişim için sabitlendi"} />
      <MetricCard label={t("transactionsInRange")} value={String(rangeItems.length).padStart(2, "0")} icon={<Activity size={18} />} accent="cyan" footer={t(periodLabels[period])} />
      <MetricCard label={t("activityVolume")} value={formatMoney(volume, language)} icon={<Banknote size={18} />} accent="gold" footer={t("trendSub")} compact />
    </div>

    {/* Full width stacked layout for Overview */}
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Financial Activity Analytics / Column Chart (Full Width) */}
      <section className="panel volume-panel">
        <div className="panel-heading">
          <div>
            <div className="panel-kicker"><span className="panel-indicator cyan" /> {t("financialActivityChart")}</div>
            <h2>{t("chartSubDescription")}</h2>
          </div>
          <div className="select-wrap mini-select">
            <select aria-label={t("period")} value={period} onChange={(event) => setPeriod(event.target.value as (typeof periodKeys)[number])}>
              {periodKeys.map((item) => <option key={item} value={item}>{t(periodLabels[item])}</option>)}
            </select>
            <ChevronDown size={13} />
          </div>
        </div>

        <div className="volume-total" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span>{t("periodTotal")}</span>
            <strong>{formatMoney(volume, language)}</strong>
          </div>
          <div className="chart-legend" style={{ display: "flex", gap: "12px", fontSize: "11px" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><i style={{ width: "8px", height: "8px", background: "#10b981", borderRadius: "2px", display: "inline-block" }} /> {t("inflow")}</span>
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><i style={{ width: "8px", height: "8px", background: "#f43f5e", borderRadius: "2px", display: "inline-block" }} /> {t("outflow")}</span>
          </div>
        </div>

        <div style={{ position: "relative", minHeight: "160px", paddingBottom: "20px" }}>
          {rangeItems.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)", fontSize: "12px" }}>{t("noDataForChart")}</div>
          ) : (
            <div className="mini-chart" style={{ height: "140px", alignItems: "flex-end", gap: "8px", paddingTop: "10px" }}>
              {rangeItems.slice(0, 30).map((item) => {
                const positive = item.kind === "topup" || item.kind === "refund";
                const heightPct = Math.max(12, Math.round((item.amount / maxAmount) * 100));
                const isHovered = hoveredTx?.id === item.id;
                return (
                  <div key={item.id} className="chart-column" style={{ flex: 1, position: "relative" }} onMouseEnter={() => setHoveredTx(item)} onMouseLeave={() => setHoveredTx(null)}>
                    <div className="chart-track" style={{ height: "100%", display: "flex", alignItems: "flex-end" }}>
                      <div
                        className="chart-bar"
                        style={{
                          height: `${heightPct}%`,
                          width: "100%",
                          background: positive ? "linear-gradient(180deg, #34d399 0%, #059669 100%)" : "linear-gradient(180deg, #fb7185 0%, #e11d48 100%)",
                          boxShadow: isHovered ? (positive ? "0 0 10px rgba(16,185,129,0.7)" : "0 0 10px rgba(244,63,94,0.7)") : "none",
                          transition: "all 0.2s ease",
                          borderRadius: "3px 3px 0 0",
                          cursor: "pointer"
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {hoveredTx && (
            <div style={{
              position: "absolute", bottom: "2px", left: "50%", transform: "translateX(-50%)",
              background: "rgba(15, 23, 42, 0.95)", border: "1px solid rgba(255,255,255,0.15)",
              backdropFilter: "blur(8px)", padding: "6px 12px", borderRadius: "6px", fontSize: "11px",
              color: "#fff", display: "flex", gap: "10px", alignItems: "center", boxShadow: "0 6px 20px rgba(0,0,0,0.5)", zIndex: 10, pointerEvents: "none", whiteSpace: "nowrap"
            }}>
              <div><strong>{hoveredTx.description}</strong></div>
              <div style={{ color: (hoveredTx.kind === "topup" || hoveredTx.kind === "refund") ? "#34d399" : "#fb7185", fontWeight: 700 }}>
                {(hoveredTx.kind === "topup" || hoveredTx.kind === "refund") ? "+" : "−"}{formatMoney(hoveredTx.amount, language)}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Recent Activity / Recorded Activity (Full Width Below Chart) */}
      <section className="panel ledger-panel">
        <div className="panel-heading ledger-heading">
          <div>
            <div className="panel-kicker"><span className="panel-indicator cyan" /> PRIVATE LEDGER</div>
            <h2>Recent activity</h2>
          </div>
          <button className="outline-small-btn" onClick={() => setActiveSection("activity")}>View all <ChevronRight size={13} /></button>
        </div>
        {rangeItems.length === 0 ? (
          <EmptyState t={t} icon={<Clock3 size={24} />} title={t("noTransactions")} description={t("noTransactionsSub")} />
        ) : (
          <TransactionTable transactions={rangeItems.slice(0, 5)} t={t} language={language} />
        )}
      </section>
    </div>

    <div className="footnote-strip"><ShieldCheck size={15} /><span>{t("demoNotice")}</span><span className="footnote-status">LOCAL DATA ONLY</span></div>
  </>;
}

function MetricCard({ label, value, icon, accent, footer, compact = false }: { label: string; value: string; icon: ReactNode; accent: string; footer: string; compact?: boolean }) {
  return <div className={`metric-card metric-${accent}`}><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><strong className={compact ? "metric-value compact-value" : "metric-value"}>{value}</strong><div className="metric-footer"><span className="metric-sparkline"><i /><i /><i /><i /><i /><i /></span><span>{footer}</span></div><div className="metric-glow" /></div>;
}

function EmptyState({ t, icon, title, description, action }: { t: (key: Parameters<typeof translate>[1]) => string; icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-orb">{icon}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

function CardsSection({
  t, language, cards, allCards, allCount, categoryFilter, setCategoryFilter, searchTerm, setSearchTerm, onAddCard, onEdit, onDelete, onFavorite, flippedCards, setFlippedCards,
}: {
  t: (key: Parameters<typeof translate>[1]) => string; language: Language; cards: VaultCard[]; allCards: VaultCard[]; allCount: number;
  categoryFilter: CardCategory | "all"; setCategoryFilter: (category: CardCategory | "all") => void;
  searchTerm: string; setSearchTerm: (value: string) => void; onAddCard: () => void; onEdit: (id: string) => void;
  onDelete: (id: string) => void; onFavorite: (id: string) => void; flippedCards: Set<string>;
  setFlippedCards: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const filterItems: Array<{ value: CardCategory | "all"; label: string }> = [
    { value: "all", label: t("allCards") }, ...CARD_CATEGORIES.map((value) => ({ value, label: categoryLabel(value, language) })),
  ];
  return <>
    <PageHeading eyebrow="CARD MANAGEMENT / 02" title={t("exploreCards")} subtitle={t("librarySub")} action={<Button className="primary-btn" variant="primary" onPress={onAddCard}><Plus size={17} /> {t("addCard")}</Button>} />
    <div className="library-toolbar"><div className="library-tabs">{filterItems.map((filter) => <button key={filter.value} className={categoryFilter === filter.value ? "library-tab active" : "library-tab"} onClick={() => setCategoryFilter(filter.value)}>{filter.label}<span>{filter.value === "all" ? allCount : allCards.filter((card) => card.category === filter.value).length}</span></button>)}</div><label className="search-field"><Search size={17} /><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t("searchCards")} aria-label={t("searchCards")} />{searchTerm && <button onClick={() => setSearchTerm("")} aria-label={t("clearSearch")}><X size={14} /></button>}</label></div>
    {cards.length === 0 ? <section className="panel library-empty"><EmptyState t={t} icon={<CreditCard size={25} />} title={allCount === 0 ? t("noCards") : t("noMatches")} description={allCount === 0 ? t("noCardsSub") : t("clearSearch")} action={allCount === 0 ? <Button className="primary-btn" variant="primary" onPress={onAddCard}><Plus size={16} /> {t("addFirstCard")}</Button> : <Button className="secondary-btn" variant="secondary" onPress={() => { setSearchTerm(""); setCategoryFilter("all"); }}>{t("clearSearch")}</Button>} /></section> : <div className="card-grid">{cards.map((card) => <CardTile key={card.id} card={card} t={t} language={language} flipped={flippedCards.has(card.id)} onFlip={() => setFlippedCards((before) => { const next = new Set(before); next.has(card.id) ? next.delete(card.id) : next.add(card.id); return next; })} onEdit={() => onEdit(card.id)} onDelete={() => onDelete(card.id)} onFavorite={() => onFavorite(card.id)} />)}</div>}
    <div className="footnote-strip"><ShieldCheck size={15} /><span>{t("numberReveal")}. {t("pinCvvWarning")}</span><span className="footnote-status">{cards.length} / {allCount}</span></div>
  </>;
}

function CardTile({ card, t, language, flipped, onFlip, onEdit, onDelete, onFavorite, compact = false }: {
  card: VaultCard; t: (key: Parameters<typeof translate>[1]) => string; language: Language; flipped: boolean;
  onFlip: () => void; onEdit: () => void; onDelete: () => void; onFavorite: () => void; compact?: boolean;
}) {
  const CategoryIcon = categoryIcons[card.category];
  return <article className={`card-tile ${compact ? "card-tile-compact" : ""}`}>
    <div className="card-tile-top"><div className="card-category-badge"><CategoryIcon size={13} /> {categoryLabel(card.category, language)}</div><div className="card-quick-actions"><button className={`icon-btn tiny-action ${card.favorite ? "is-favorite" : ""}`} aria-label={t(card.favorite ? "unfavorite" : "favorite")} title={t(card.favorite ? "unfavorite" : "favorite")} onClick={onFavorite}><Heart size={15} fill={card.favorite ? "currentColor" : "none"} /></button><button className="edit-link" onClick={onEdit}><Pencil size={13} /> {t("edit")}</button><button className="icon-btn tiny-action danger-hover" aria-label={t("delete")} title={t("delete")} onClick={onDelete}><Trash2 size={15} /></button></div></div>
    <button className={`bank-card-preview accent-${card.accent} ${flipped ? "is-flipped" : ""}`} aria-label={`${card.name}: ${t("flipHint")}`} onClick={onFlip}>
      <span className="card-shine" /><span className="card-orbit card-orbit-a" /><span className="card-orbit card-orbit-b" />
      <span className="card-face card-face-front">
        <span className="card-issuer"><span className="issuer-symbol"><span /><span /></span><span className="issuer-name">{card.bank || "PRIVATE ISSUER"}</span><span className="contactless"><span>)))</span></span></span>
        <span className="chip-shape"><i /><i /><i /><b /><em /></span>
        <span className="card-number-preview">{formatCardNumber(card.number)}</span>
        <span className="card-preview-bottom"><span><small>{t("cardHolder")}</small><strong>{(card.holder || "CARDHOLDER").toUpperCase()}</strong></span><span><small>{t("validThru")}</small><strong>{card.expiry || "••/••"}</strong></span><span className={`network-logo network-${detectNetwork(card.number).toLowerCase()}`}>{detectNetwork(card.number)}</span></span>
        <span className="card-watermark">TC</span>
      </span>
      <span className="card-face card-face-back">
        <span className="magnetic-strip" /><span className="card-back-caption">{t("protectedData")}</span>
        <span className="card-back-number">{formatCardNumber(card.number, flipped && Boolean(card.number))}</span>
        <span className="card-back-details"><span><small>{t("cardName")}</small><strong>{card.name}</strong></span><span><small>{t("expiry")}</small><strong>{card.expiry || "—"}</strong></span></span>
        <span className="card-back-foot"><Lock size={11} /> {t("numberReveal")}</span>
      </span>
    </button>
    <div className="card-tile-info"><div><h3>{card.name}</h3><p>{card.bank} <span>·</span> {card.number ? `•••• ${card.number.replace(/\D/g, "").slice(-4)}` : t("noCardNumber")}</p></div><button className="flip-hint" onClick={onFlip}><ArrowLeftRight size={13} /> {t("flipHint")}</button></div>
    {card.tags.length > 0 && <div className="tag-row">{card.tags.map((tag) => <span className="tag-chip" key={tag}><Tag size={10} /> {tag}</span>)}</div>}
  </article>;
}

/** Activity Section: Contains Fast Transaction Entry at the top, Ledger Table, and Neon Glass Export Buttons for Activity Log */
function ActivitySection({ t, language, transactions, allPeriodTransactions, totalVolume, period, setPeriod, kindFilter, setKindFilter, cards, historyCount, onClearHistory, onAddCard, onAddTransaction, setNotice }: {
  t: (key: Parameters<typeof translate>[1]) => string; language: Language; transactions: LedgerTransaction[]; allPeriodTransactions: LedgerTransaction[]; totalVolume: number;
  period: (typeof periodKeys)[number]; setPeriod: (period: (typeof periodKeys)[number]) => void;
  kindFilter: TransactionKind | "all"; setKindFilter: (kind: TransactionKind | "all") => void;
  cards: VaultCard[]; historyCount: number; onClearHistory: () => void; onAddCard: () => void;
  onAddTransaction: (event: FormEvent<HTMLFormElement>) => void; setNotice: (notice: Notice | null) => void;
}) {
  const [selectedTxKind, setSelectedTxKind] = useState<TransactionKind>("payment");
  const isOutgoing = selectedTxKind === "payment" || selectedTxKind === "withdrawal";

  const exportActivityCsv = () => {
    if (allPeriodTransactions.length === 0) return;
    const headers = language === "tr" ? ["Tarih", "Islem Aciklamasi", "Bagli Kart", "Islem Turu", "Tutar (TRY)", "Not"] : ["Date", "Transaction Description", "Linked Card", "Kind", "Amount (TRY)", "Note"];
    const rows = allPeriodTransactions.map(item => [
      formatDate(item.occurredAt, language, true),
      `"${item.description.replace(/"/g, '""')}"`,
      `"${item.cardLabel.replace(/"/g, '""')}"`,
      transactionLabel(item.kind, language),
      item.amount,
      `"${(item.note || "").replace(/"/g, '""')}"`
    ]);
    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tuncard-activity-report-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice({ type: "success", text: language === "tr" ? "Aktivite CSV Raporu başarıyla oluşturuldu." : "Activity CSV report generated successfully." });
  };

  const exportActivityPdf = () => {
    if (allPeriodTransactions.length === 0) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="${language}">
      <head>
        <meta charset="utf-8">
        <title>Tuncard Professional Activity Statement Report</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111; padding: 40px; margin: 0; background: #fff; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #00f2fe; padding-bottom: 20px; margin-bottom: 30px; }
          .brand { font-size: 24px; font-weight: 800; letter-spacing: 1px; color: #0b0f19; }
          .brand span { color: #00bcd4; }
          .meta { font-size: 13px; color: #555; text-align: right; }
          .summary-box { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 30px; }
          .card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px 20px; border-radius: 8px; }
          .card small { display: block; color: #64748b; font-size: 11px; text-transform: uppercase; margin-bottom: 5px; }
          .card strong { font-size: 18px; color: #0f172a; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
          th, td { padding: 12px 14px; text-align: left; border-bottom: 1px solid #e2e8f0; }
          th { background: #f1f5f9; color: #334155; font-weight: 700; text-transform: uppercase; font-size: 11px; }
          .pos { color: #10b981; font-weight: 600; }
          .neg { color: #f43f5e; font-weight: 600; }
          .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">TUNC<span>ARD</span></div>
            <div style="font-size: 12px; color: #64748b; margin-top: 3px;">PROFESSIONAL ACTIVITY LOG & LEDGER REPORT</div>
          </div>
          <div class="meta">
            <div><strong>${language === "tr" ? "Rapor Dönemi" : "Period"}:</strong> ${t(periodLabels[period])}</div>
            <div><strong>${language === "tr" ? "Oluşturulma" : "Generated"}:</strong> ${new Date().toLocaleString()}</div>
          </div>
        </div>

        <div class="summary-box">
          <div class="card"><small>${language === "tr" ? "Toplam İşlem Sayısı" : "Total Entries"}</small><strong>${allPeriodTransactions.length}</strong></div>
          <div class="card"><small>${language === "tr" ? "Toplam Hacim" : "Total Volume"}</small><strong>${formatMoney(totalVolume, language)}</strong></div>
          <div class="card"><small>${language === "tr" ? "Kayıtlı Kart Sayısı" : "Stored Cards"}</small><strong>${cards.length}</strong></div>
        </div>

        <h3 style="margin-bottom: 10px; font-size: 16px; color: #1e293b;">${language === "tr" ? "Aktivite Log Detay Raporu" : "Detailed Activity Log Statement"}</h3>
        <table>
          <thead>
            <tr>
              <th>${language === "tr" ? "Tarih & Saat" : "Date & Time"}</th>
              <th>${language === "tr" ? "Açıklama" : "Description"}</th>
              <th>${language === "tr" ? "Kart" : "Card"}</th>
              <th>${language === "tr" ? "Tür" : "Kind"}</th>
              <th style="text-align: right;">${language === "tr" ? "Tutar" : "Amount"}</th>
            </tr>
          </thead>
          <tbody>
            ${allPeriodTransactions.map(tx => {
              const positive = tx.kind === "topup" || tx.kind === "refund";
              return `
                <tr>
                  <td>${formatDate(tx.occurredAt, language, true)}</td>
                  <td><strong>${tx.description}</strong>${tx.note ? `<br/><span style="color:#64748b; font-size:11px;">${tx.note}</span>` : ''}</td>
                  <td>${tx.cardLabel}</td>
                  <td>${transactionLabel(tx.kind, language)}</td>
                  <td style="text-align: right;" class="${positive ? 'pos' : 'neg'}">${positive ? '+' : '−'}${formatMoney(tx.amount, language)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>

        <div class="footer">
          Tuncard Local Vault OS · Secure Activity Log Report · Generated on device.
        </div>
        <script>
          window.onload = function() { window.print(); };
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    setNotice({ type: "success", text: language === "tr" ? "Aktivite PDF Raporu başarıyla oluşturuldu." : "Activity PDF report generated successfully." });
  };

  return <>
    <PageHeading
      eyebrow="PRIVATE LEDGER / 03"
      title={t("transactionHistory")}
      subtitle={t("historySub")}
      action={
        <div className="flex gap-3">
          {/* Activity CSV Button with Neon Green Glass Hover */}
          <button
            onClick={exportActivityCsv}
            disabled={allPeriodTransactions.length === 0}
            className="neon-csv-btn flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "rgba(16, 185, 129, 0.08)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              color: "#34d399",
              backdropFilter: "blur(8px)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(16, 185, 129, 0.25)";
              e.currentTarget.style.borderColor = "#10b981";
              e.currentTarget.style.boxShadow = "0 0 20px rgba(16, 185, 129, 0.4)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(16, 185, 129, 0.08)";
              e.currentTarget.style.borderColor = "rgba(16, 185, 129, 0.3)";
              e.currentTarget.style.boxShadow = "none";
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.background = "#065f46";
              e.currentTarget.style.color = "#ffffff";
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.background = "rgba(16, 185, 129, 0.25)";
              e.currentTarget.style.color = "#34d399";
            }}
          >
            <Download size={15} /> {t("downloadCsvReport")}
          </button>

          {/* Activity PDF Button with Neon Red Glass Hover */}
          <button
            onClick={exportActivityPdf}
            disabled={allPeriodTransactions.length === 0}
            className="neon-pdf-btn flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "rgba(244, 63, 94, 0.08)",
              border: "1px solid rgba(244, 63, 94, 0.3)",
              color: "#fb7185",
              backdropFilter: "blur(8px)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(244, 63, 94, 0.25)";
              e.currentTarget.style.borderColor = "#f43f5e";
              e.currentTarget.style.boxShadow = "0 0 20px rgba(244, 63, 94, 0.4)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(244, 63, 94, 0.08)";
              e.currentTarget.style.borderColor = "rgba(244, 63, 94, 0.3)";
              e.currentTarget.style.boxShadow = "none";
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.background = "#9f1239";
              e.currentTarget.style.color = "#ffffff";
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.background = "rgba(244, 63, 94, 0.25)";
              e.currentTarget.style.color = "#fb7185";
            }}
          >
            <FileText size={15} /> {t("downloadPdfReport")}
          </button>
        </div>
      }
    />

    {/* Fast Transaction Entry Form moved to Activity top */}
    <section className={`panel embedded-transaction-panel ${isOutgoing ? "is-outgoing" : "is-incoming"}`} style={{ marginBottom: "24px" }}>
      <div className="panel-heading">
        <div>
          <div className="panel-kicker"><span className={`panel-indicator ${isOutgoing ? "rose" : "cyan"}`} /> FAST TRANSACTION ENTRY</div>
          <h2>{t("recordTransaction")}</h2>
        </div>
        <span className="session-chip"><span className="session-pulse" /> LIVE SYNC</span>
      </div>
      {cards.length === 0 ? (
        <EmptyState t={t} icon={<Wallet size={24} />} title={t("noCards")} description={t("noCardsSub")} action={<Button className="primary-btn" variant="primary" onPress={onAddCard}><Plus size={16} /> {t("addFirstCard")}</Button>} />
      ) : (
        <form className="modal-form transaction-form" onSubmit={onAddTransaction} style={{ padding: "10px 22px 22px" }}>
          <div className="form-grid-two">
            <label className="field-label">{t("transactionType")}
              <div className="select-wrap full-select">
                <select name="kind" defaultValue="payment" onChange={(e) => setSelectedTxKind(e.target.value as TransactionKind)}>
                  {transactionKinds.map((kind) => <option key={kind} value={kind}>{transactionLabel(kind, language)}</option>)}
                </select>
                <ChevronDown size={14} />
              </div>
            </label>
            <label className="field-label">{t("linkedCard")}
              <div className="select-wrap full-select">
                <select name="cardId" required defaultValue="">
                  <option value="" disabled>{t("chooseCard")}</option>
                  {cards.map((card) => <option key={card.id} value={card.id}>{card.name} · {card.bank}</option>)}
                </select>
                <ChevronDown size={14} />
              </div>
            </label>
          </div>
          <label className="field-label">{t("description")}
            <input name="description" maxLength={80} required placeholder={t("descriptionPlaceholder")} />
          </label>
          <div className="form-grid-two">
            <label className="field-label">{t("amount")}
              <div className="amount-input"><span>₺</span><input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00" /></div>
            </label>
            <label className="field-label">{t("occurredAt")}
              <input name="occurredAt" type="datetime-local" max={localDateTimeValue()} defaultValue={localDateTimeValue()} required />
            </label>
          </div>
          <div className="modal-actions" style={{ borderTop: "0", marginTop: "5px", paddingBottom: "0" }}>
            <Button type="submit" className="primary-btn" variant="primary" style={{ width: "100%" }}><Plus size={16} /> {t("saveTransaction")}</Button>
          </div>
        </form>
      )}
    </section>

    <div className="activity-summary-grid">
      <div className="summary-tile"><span className="summary-icon"><Activity size={17} /></span><span>{t("transactionsInRange")}</span><strong>{transactions.length.toString().padStart(2, "0")}</strong></div>
      <div className="summary-tile"><span className="summary-icon summary-cyan"><Banknote size={17} /></span><span>{t("periodTotal")}</span><strong>{formatMoney(totalVolume, language)}</strong></div>
      <div className="summary-tile"><span className="summary-icon summary-gold"><CreditCard size={17} /></span><span>{t("totalCards")}</span><strong>{cards.length.toString().padStart(2, "0")}</strong></div>
    </div>

    {/* Transaction Ledger Table Panel */}
    <section className="panel ledger-panel">
      <div className="panel-heading ledger-heading">
        <div>
          <div className="panel-kicker"><span className="panel-indicator cyan" /> LOCAL ACTIVITY LOG</div>
          <h2>{t("activity")}</h2>
        </div>
        <div className="ledger-heading-controls">
          {historyCount > 0 && <button className="danger-quiet-btn" onClick={onClearHistory}><Trash2 size={13} /> {t("clearHistory")}</button>}
          <div className="ledger-filters">
            <label className="select-wrap">
              <Filter size={14} />
              <select aria-label={t("period")} value={period} onChange={(event) => setPeriod(event.target.value as (typeof periodKeys)[number])}>
                {periodKeys.map((item) => <option key={item} value={item}>{t(periodLabels[item])}</option>)}
              </select>
              <ChevronDown size={13} />
            </label>
            <label className="select-wrap">
              <select aria-label={t("transactionType")} value={kindFilter} onChange={(event) => setKindFilter(event.target.value as TransactionKind | "all")}>
                <option value="all">{t("allTypes")}</option>
                {transactionKinds.map((kind) => <option key={kind} value={kind}>{transactionLabel(kind, language)}</option>)}
              </select>
              <ChevronDown size={13} />
            </label>
          </div>
        </div>
      </div>
      {transactions.length === 0 ? (
        <EmptyState t={t} icon={<Clock3 size={24} />} title={t("noTransactions")} description={t("noTransactionsSub")} />
      ) : (
        <TransactionTable transactions={transactions} t={t} language={language} expanded />
      )}
    </section>
    <div className="footnote-strip"><CircleHelp size={15} /><span>{t("historySub")}</span><span className="footnote-status">CRM READY LOG</span></div>
  </>;
}

function TransactionTable({ transactions, t, language, expanded = false }: { transactions: LedgerTransaction[]; t: (key: Parameters<typeof translate>[1]) => string; language: Language; expanded?: boolean }) {
  return <div className={`transaction-list ${expanded ? "transaction-list-expanded" : ""}`}>
    {transactions.map((item) => {
      const Icon = txIcon(item.kind);
      const positive = item.kind === "topup" || item.kind === "refund";
      return <div className="transaction-row" key={item.id}><div className={`transaction-type-icon type-${item.kind}`}><Icon size={17} /></div><div className="transaction-main"><strong>{item.description}</strong><span>{item.cardLabel} <i /> {formatDate(item.occurredAt, language, true)}</span>{expanded && item.note && <small className="transaction-note">{item.note}</small>}</div><div className="transaction-kind-label">{transactionLabel(item.kind, language)}</div><div className={`transaction-amount ${positive ? "amount-positive" : ""}`}>{positive ? "+" : "−"}{formatMoney(item.amount, language)}</div>
      </div>;
    })}
  </div>;
}

function SecuritySection({ t, language, theme, setTheme, setLanguage, onLock, onExport, onRestore, onChangePassword, cardCount, transactionCount }: {
  t: (key: Parameters<typeof translate>[1]) => string; language: Language; theme: Theme; setTheme: (theme: Theme) => void;
  setLanguage: (language: Language) => void; onLock: () => void; onExport: () => void; onRestore: () => void; onChangePassword: () => void; cardCount: number; transactionCount: number;
}) {
  return <>
    <PageHeading eyebrow="PRIVACY CENTER / 04" title={t("settingsTitle")} subtitle={t("settingsSub")} />
    <div className="security-layout">
      <div className="security-main-column">
        <section className="panel security-panel"><div className="panel-heading"><div><div className="panel-kicker"><span className="panel-indicator cyan" /> {t("vaultStatus")}</div><h2>{t("encrypted")}</h2></div><span className="security-status"><CheckCircle2 size={14} /> ACTIVE</span></div>
          <div className="crypto-diagram"><div className="crypto-node"><LockKeyhole size={23} /><span>LOCAL STORAGE</span></div><div className="crypto-line"><i /><i /><i /></div><div className="crypto-node crypto-node-highlight"><FileKey2 size={23} /><span>AES-GCM 256</span></div><div className="crypto-line"><i /><i /><i /></div><div className="crypto-node"><TkFingerprintLogo size={23} /><span>MASTER KEY</span></div></div>
          <div className="security-copy"><h3>{t("encryptionMethod")}</h3><p>{t("encryptionDescription")}</p></div>
          <div className="settings-facts"><div><span>{t("cardCount")}</span><strong>{cardCount.toString().padStart(2, "0")}</strong></div><div><span>{t("transactionCount")}</span><strong>{transactionCount.toString().padStart(2, "0")}</strong></div><div><span>{language === "en" ? "Storage" : "Depolama"}</span><strong>Browser only</strong></div></div>
        </section>
        <section className="panel settings-panel"><div className="panel-heading"><div><div className="panel-kicker"><span className="panel-indicator rose" /> ACCESS CONTROL</div><h2>{t("security")}</h2></div><span className="settings-symbol"><KeyRound size={18} /></span></div>
          <SettingsRow icon={<Clock3 size={17} />} title={t("autoLock")} description={t("autoLockDescription")} trailing={<span className="setting-value"><span className="tiny-green" /> 10 MIN</span>} />
          <SettingsRow icon={<KeyRound size={17} />} title={t("passwordChange")} description={t("noPassphraseRecovery")} trailing={<button className="outline-small-btn" onClick={onChangePassword}>{t("changePassword")} <ChevronRight size={13} /></button>} />
          <SettingsRow icon={<Lock size={17} />} title={t("lockNow")} description={t("lockedDescription")} trailing={<button className="outline-small-btn" onClick={onLock}>{t("lock")} <LockKeyhole size={13} /></button>} last />
        </section>
      </div>
      <div className="security-side-column">
        <section className="panel settings-panel"><div className="panel-heading"><div><div className="panel-kicker"><span className="panel-indicator gold" /> BACKUP MANAGEMENT</div><h2>{t("backupFormat")}</h2></div><span className="settings-symbol gold-icon"><Download size={18} /></span></div>
          <p className="settings-panel-intro">{t("backupDescription")}</p>
          <div className="backup-actions"><button className="secondary-btn" onClick={onExport}><Download size={16} /> {t("exportBackup")}</button><button className="outline-small-btn" onClick={onRestore}>{t("restoreBackup")} <ChevronRight size={14} /></button></div>
        </section>
        <section className="security-warning"><div className="warning-head"><span><Shield size={17} /></span><strong>{t("securityLimit")}</strong></div><p>{t("pinCvvWarning")}</p><p>{t("localWarning")}</p><p className="pci-note">{t("pciiWarning")}</p></section>
        <section className="panel system-status"><div className="system-status-top"><span><span className="status-dot" /> {t("allGood")}</span><BadgeCheck size={19} /></div><div className="system-stat-line"><span>LOCAL ENCRYPTION</span><b>ACTIVE</b></div><div className="system-stat-line"><span>NETWORK TRANSFER</span><b>NONE</b></div><div className="system-stat-line"><span>SESSION</span><b>PRIVATE</b></div><div className="system-hash">SHA-256 / PBKDF2 / AES-GCM</div></section>
        <section className="security-warning">
          <div className="warning-head"><span><Sparkles size={17} /></span><strong>{language === "en" ? "About Tuncard & Purpose" : "Tuncard Hakkında & Amaç"}</strong></div>
          <p><strong>{language === "en" ? "Purpose:" : "Amacı:"}</strong> {language === "en" ? "To securely manage and store your sensitive financial cards and records locally under your absolute control." : "Hassas finansal kartlarınızı ve kayıtlarınızı hiçbir bulut sunucusuna bağımlı kalmadan tamamen kendi kontrolünüz altında güvenle saklamak."}</p>
          <p><strong>{language === "en" ? "What it does:" : "Ne İşe Yarar?:"}</strong> {language === "en" ? "Organizes cards into categories, keeps a private transaction ledger, and secures everything with client-side AES-GCM 256-bit encryption." : "Kartlarınızı kategorize eder, yerel işlem defteri (ledger) tutar ve tüm verileri tarayıcınızda AES-GCM 256-bit ile şifreler."}</p>
          <p className="pci-note"><strong>{language === "en" ? "Why use it:" : "Neden Kullanılır?:"}</strong> {language === "en" ? "Provides 100% privacy with zero server dependency, eliminating data breach risks." : "Bulut sızıntı risklerini sıfırlayan %100 yerel (local-first) mimarisi ve gizlilik odaklı yapısı sayesinde tam mahremiyet sağlar."}</p>
        </section>
      </div>
    </div>
  </>;
}

function SettingsRow({ icon, title, description, trailing, last = false }: { icon: ReactNode; title: string; description: string; trailing: ReactNode; last?: boolean }) {
  return <div className={`settings-row ${last ? "settings-row-last" : ""}`}><span className="settings-row-icon">{icon}</span><div className="settings-row-copy"><strong>{title}</strong><p>{description}</p></div><div className="settings-row-action">{trailing}</div></div>;
}

function DialogFrame({ title, eyebrow, onClose, children, wide = false, lockClose = false }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode; wide?: boolean; lockClose?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (!lockClose && event.currentTarget === event.target) onClose(); }}><section className={`modal-card ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><div><div className="panel-kicker"><span className="panel-indicator violet" /> {eyebrow}</div><h2>{title}</h2></div>{!lockClose && <button className="icon-btn" aria-label="Close dialog" onClick={onClose}><X size={18} /></button>}</header>{children}</section></div>;
}

function CardFormDialog({ t, language, card, onClose, onSubmit }: {
  t: (key: Parameters<typeof translate>[1]) => string; language: Language; card?: VaultCard; onClose: () => void;
  onSubmit: (card: CardFormValues & { id?: string }, wasEditing: boolean) => void;
}) {
  const [formError, setFormError] = useState("");
  const [numberValue, setNumberValue] = useState(formatCardNumberInput(card?.number ?? ""));
  const [favorite, setFavorite] = useState(card?.favorite ?? false);
  const [accent, setAccent] = useState<CardAccent>(card?.accent ?? "aurora");
  const [category, setCategory] = useState<CardCategory>(card?.category ?? "debit");
  const [tagsValue, setTagsValue] = useState((card?.tags ?? []).join(", "));
  const categoryChoices: Array<{ value: CardCategory; icon: ReactNode; label: string }> = [
    { value: "debit", icon: <Landmark size={15} />, label: t("debit") },
    { value: "credit", icon: <CreditCard size={15} />, label: t("credit") },
    { value: "virtual", icon: <Zap size={15} />, label: t("virtual") },
    { value: "gift", icon: <Gift size={15} />, label: t("gift") },
  ];
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = {
      name: String(form.get("name") ?? "").trim().slice(0, 50),
      holder: String(form.get("holder") ?? "").trim().slice(0, 70),
      bank: String(form.get("bank") ?? "").trim().slice(0, 70),
      number: normalizeCardNumber(numberValue),
      expiry: String(form.get("expiry") ?? "").trim(),
      category, accent, favorite,
      tags: sanitizeTags(tagsValue),
    } satisfies CardFormValues;
    const validation = validateCardForm({ ...values, tagsText: tagsValue });
    if (validation) { setFormError(t(validation as Parameters<typeof translate>[1])); return; }
    setFormError("");
    onSubmit({ ...values, ...(card ? { id: card.id } : {}) }, Boolean(card));
  };
  return <DialogFrame title={card ? t("editDetails") : t("addCard")} eyebrow="CARD CONFIGURATION" onClose={onClose} wide>
    <form className="modal-form card-form" noValidate onSubmit={submit}>
      <div className="form-section-title"><span>01</span><strong>{t("details")}</strong><i /></div>
      <div className="form-grid-two"><label className="field-label">{t("cardName")}<input name="name" maxLength={50} required defaultValue={card?.name ?? ""} placeholder={language === "en" ? "Everyday essentials" : "Günlük harcamalar"} /></label><label className="field-label">{t("cardHolderName")}<input name="holder" maxLength={70} required defaultValue={card?.holder ?? ""} placeholder="ALEX MORGAN" autoComplete="off" /></label></div>
      <div className="form-grid-two"><label className="field-label">{t("bankName")}<input name="bank" maxLength={70} required defaultValue={card?.bank ?? ""} placeholder={language === "en" ? "Your bank or provider" : "Banka veya sağlayıcı"} /></label><label className="field-label">{t("numberOptional")}<div className="input-with-icon"><CreditCard size={16} /><input name="number" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={23} required aria-required="true" value={numberValue} onChange={(event) => setNumberValue(formatCardNumberInput(event.target.value))} placeholder="0000 0000 0000 0000" /></div></label></div>
      <p className="field-hint"><Lock size={12} /> {t("hiddenNumberHint")}</p>
      <div className="form-grid-two"><label className="field-label">{t("expiry")}<input name="expiry" maxLength={5} defaultValue={card?.expiry ?? ""} placeholder="MM/YY" inputMode="numeric" /></label><label className="field-label">{t("tags")}<div className="input-with-icon"><Tag size={15} /><input name="tags" value={tagsValue} onChange={(event) => setTagsValue(event.target.value)} maxLength={250} placeholder={t("tagsPlaceholder")} /></div></label></div>
      <p className="field-hint">{language === "en" ? "Optional metadata only. Never enter your PIN, CVV/CVC or bank password." : "Yalnızca isteğe bağlı bilgiler. PIN, CVV/CVC veya banka parolanı asla girme."}</p>
      <div className="form-section-title"><span>02</span><strong>{t("category")}</strong><i /></div>
      <div className="category-choice-grid">{categoryChoices.map((choice) => <button type="button" key={choice.value} className={`category-choice ${category === choice.value ? "selected" : ""}`} onClick={() => setCategory(choice.value)}>{choice.icon}<span>{choice.label}</span>{category === choice.value && <Check size={13} />}</button>)}</div>
      <div className="form-section-title"><span>03</span><strong>{t("appearance")}</strong><i /></div>
      <div className="accent-choice-grid">{CARD_ACCENTS.map((value) => <button type="button" key={value} className={`accent-choice accent-choice-${value} ${accent === value ? "selected" : ""}`} onClick={() => setAccent(value)}><span className="accent-swatch" /><span>{({ aurora: "Aurora pearl", ocean: "Arctic glass", rose: "Rose quartz", gold: "Champagne" } as const)[value]}</span>{accent === value && <Check size={13} />}</button>)}</div>
      <label className="favorite-toggle"><input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} /><span className="favorite-toggle-ui"><Heart size={15} /></span><span><strong>{t("favoriteCard")}</strong><small>{language === "en" ? "Keep this card at the top of your collection." : "Bu kartı koleksiyonunun en üstünde tut."}</small></span></label>
      {formError && <div className="inline-error"><CircleHelp size={15} /> {formError}</div>}
      <div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>{t("cancel")}</button><Button type="submit" className="primary-btn" variant="primary"><ShieldCheck size={16} /> {card ? t("updateCard") : t("saveCard")}</Button></div>
    </form>
  </DialogFrame>;
}

function TransactionFormDialog({ t, language, cards, onClose, onSubmit }: {
  t: (key: Parameters<typeof translate>[1]) => string; language: Language; cards: VaultCard[]; onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <DialogFrame title={t("recordTransaction")} eyebrow="MANUAL LEDGER ENTRY" onClose={onClose}>
    <form className="modal-form transaction-form" onSubmit={onSubmit}>
      <div className="transaction-form-note"><Activity size={16} /><span>{t("historySub")}</span></div>
      <label className="field-label">{t("transactionType")}<div className="select-wrap full-select"><select name="kind" defaultValue="payment">{transactionKinds.map((kind) => <option key={kind} value={kind}>{transactionLabel(kind, language)}</option>)}</select><ChevronDown size={14} /></div></label>
      <label className="field-label">{t("linkedCard")}<div className="select-wrap full-select"><select name="cardId" required defaultValue=""><option value="" disabled>{t("chooseCard")}</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.name} · {card.bank}</option>)}</select><ChevronDown size={14} /></div></label>
      <label className="field-label">{t("description")}<input name="description" maxLength={80} required placeholder={t("descriptionPlaceholder")} /></label>
      <div className="form-grid-two"><label className="field-label">{t("amount")}<div className="amount-input"><span>₺</span><input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00" /></div></label><label className="field-label">{t("occurredAt")}<input name="occurredAt" type="datetime-local" max={localDateTimeValue()} defaultValue={localDateTimeValue()} required /></label></div>
      <label className="field-label">{t("note")}<textarea name="note" maxLength={500} rows={3} placeholder={t("notePlaceholder")} /></label>
      <div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>{t("cancel")}</button><Button type="submit" className="primary-btn" variant="primary"><Plus size={16} /> {t("saveTransaction")}</Button></div>
    </form>
  </DialogFrame>;
}

function ConfirmDialog({ t, language, action, card, onClose, onConfirm }: {
  t: (key: Parameters<typeof translate>[1]) => string; language: Language; action: PendingAction; card?: VaultCard; onClose: () => void; onConfirm: () => void;
}) {
  const isDelete = action.kind === "delete-card";
  const isEdit = action.kind === "save-card" && action.wasEditing;
  return <DialogFrame title={t("confirmTitle")} eyebrow="CONFIRMATION REQUIRED" onClose={onClose}>
    <div className="confirm-content"><div className={`confirm-orb ${isDelete ? "confirm-danger" : ""}`}>{isDelete ? <Trash2 size={25} /> : <ShieldCheck size={25} />}</div><h3>{isDelete ? t("delete") : isEdit ? t("saveChanges") : t("saveCard")}</h3><p>{isDelete ? t("confirmDelete") : isEdit ? t("confirmUpdate") : t("confirmSave")}</p>{card && <div className="confirm-card-line"><span className={`confirm-card-swatch accent-${card.accent}`}><CreditCard size={18} /></span><span><strong>{card.name}</strong><small>{card.bank} · {categoryLabel(card.category, language)}</small></span><ChevronRight size={15} /></div>}<div className="modal-actions confirm-actions"><button type="button" className="secondary-btn" onClick={onClose}>{t("noCancel")}</button><Button className={isDelete ? "danger-btn" : "primary-btn"} variant={isDelete ? "danger" : "primary"} onPress={onConfirm}>{isDelete ? <Trash2 size={15} /> : <Check size={16} />}{t("yesConfirm")}</Button></div></div>
  </DialogFrame>;
}

function PasswordChangeDialog({ t, onClose, onSubmit }: { t: (key: Parameters<typeof translate>[1]) => string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const canSave = isValidMasterPassword(newPassword) && newPassword === confirmPassword;
  return <DialogFrame title={t("passwordChange")} eyebrow="KEY ROTATION" onClose={onClose}>
    <form className="modal-form" onSubmit={onSubmit}><div className="transaction-form-note"><ShieldCheck size={16} /><span>{t("noPassphraseRecovery")}</span></div><label className="field-label">{t("currentPassword")}<input name="currentPassword" type="password" autoComplete="current-password" required /></label><label className="field-label">{t("newPassword")}<input name="newPassword" type="password" autoComplete="new-password" value={newPassword} maxLength={16} onChange={(event) => setNewPassword(sanitizeMasterPasswordInput(event.target.value))} required /></label><PasswordRules t={t} password={newPassword} /><label className="field-label">{t("confirmPassphrase")}<input name="confirmPassword" type="password" autoComplete="new-password" value={confirmPassword} maxLength={16} onChange={(event) => setConfirmPassword(sanitizeMasterPasswordInput(event.target.value))} required /></label>{newPassword && confirmPassword && newPassword !== confirmPassword && <div className="inline-error"><CircleHelp size={14} /> {t("passwordMismatch")}</div>}<div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>{t("cancel")}</button><Button type="submit" className="primary-btn" variant="primary" isDisabled={!canSave}><KeyRound size={15} /> {t("changePassword")}</Button></div></form>
  </DialogFrame>;
}

function PasswordRules({ t, password }: { t: (key: Parameters<typeof translate>[1]) => string; password: string }) {
  const rules = getMasterPasswordRules(password);
  const entries: Array<{ key: keyof typeof rules; label: Parameters<typeof translate>[1] }> = [
    { key: "length", label: "passwordRuleLength" },
    { key: "uppercase", label: "passwordRuleUppercase" },
    { key: "lowercase", label: "passwordRuleLowercase" },
    { key: "special", label: "passwordRuleSpecial" },
    { key: "safeCharacters", label: "passwordRuleSafe" },
    { key: "repeatedDigits", label: "passwordRuleRepeatedDigits" },
  ];
  return <div className="password-rules" aria-live="polite"><strong>{t("passwordRulesTitle")}</strong><ul>{entries.map((entry) => <li key={entry.key} className={rules[entry.key] ? "rule-passed" : "rule-pending"}>{rules[entry.key] ? <CheckCircle2 size={13} /> : <span className="rule-bang">!</span>}<span>{t(entry.label)}</span></li>)}</ul></div>;
}

function RecoveryKeyDialog({ t, recoveryCode, onClose }: {
  t: (key: Parameters<typeof translate>[1]) => string; recoveryCode: string; onClose: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [localError, setLocalError] = useState("");
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(recoveryCode); setSaved(true); setLocalError(""); }
    catch { setLocalError(t("recoverySaveFileFirst")); }
  };
  const downloadCode = async () => {
    const contents = `TUNCARD STUDIO — RECOVERY KEY\n${recoveryCode}\n\nKeep this key private. Anyone with this key can unlock your local Tuncard vault. Store this file separately from your computer.`;
    try {
      type WritableTextFile = { write: (data: string | Blob) => Promise<void>; close: () => Promise<void> };
      type SaveHandle = { createWritable: () => Promise<WritableTextFile> };
      type SavePickerWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<SaveHandle> };
      const pickerWindow = window as SavePickerWindow;
      if (pickerWindow.showSaveFilePicker) {
        const handle = await pickerWindow.showSaveFilePicker({ suggestedName: "tuncard-recovery-key.txt", types: [{ description: "Text file", accept: { "text/plain": [".txt"] } }] });
        const writable = await handle.createWritable(); await writable.write(contents); await writable.close();
      } else {
        const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a"); link.href = url; link.download = "tuncard-recovery-key.txt";
        document.body.appendChild(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }
      setSaved(true); setLocalError("");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLocalError(t("recoverySaveFileFirst"));
    }
  };
  return <DialogFrame title={t("recoveryTitle")} eyebrow={t("recoveryEyebrow")} onClose={onClose} lockClose={!saved}>
    <div className="recovery-dialog-content"><div className="recovery-dialog-orb"><FileKey2 size={24} /></div><p>{t("recoveryDescription")}</p><div className="recovery-warning"><ShieldCheck size={18} /> <span>{t("recoveryWarning")}</span></div><label className="recovery-code-label">{t("recoveryCodeLabel")}</label><div className="recovery-code-box"><code>{recoveryCode}</code><button type="button" onClick={copyCode} aria-label={t("copyRecoveryCode")}><Copy size={15} /> {t("copyRecoveryCode")}</button></div><div className="recovery-save-actions"><button type="button" className="primary-btn" onClick={downloadCode}><Download size={15} /> {t("downloadRecoveryCode")}</button></div>{localError && <div className="inline-error" role="alert">{localError}</div>}{saved && <div className="recovery-saved-state"><CheckCircle2 size={15} /> {t("recoveryAcknowledged")}</div>}<div className="modal-actions recovery-final-action"><Button className="primary-btn" variant="primary" isDisabled={!saved} onPress={onClose}><Check size={15} /> {t("recoveryDone")}</Button></div></div>
  </DialogFrame>;
}

function ConfirmClearHistoryDialog({ t, onClose, onConfirm }: { t: (key: Parameters<typeof translate>[1]) => string; onClose: () => void; onConfirm: () => void }) {
  return <DialogFrame title={t("clearHistoryConfirmTitle")} eyebrow={t("clearHistoryEyebrow")} onClose={onClose}><div className="confirm-content"><div className="confirm-orb confirm-danger"><Trash2 size={25} /></div><h3>{t("clearHistoryConfirmTitle")}</h3><p>{t("clearHistoryConfirm")}</p><div className="modal-actions confirm-actions"><button type="button" className="secondary-btn" onClick={onClose}>{t("noCancel")}</button><Button className="danger-btn" variant="danger" onPress={onConfirm}><Trash2 size={15} /> {t("yesConfirm")}</Button></div></div></DialogFrame>;
}

function ConfirmRestoreDialog({ t, onClose, onConfirm }: { t: (key: Parameters<typeof translate>[1]) => string; onClose: () => void; onConfirm: () => void }) {
  return <DialogFrame title={t("restoreBackup")} eyebrow="BACKUP RESTORE" onClose={onClose}><div className="confirm-content"><div className="confirm-orb confirm-danger"><Download size={24} /></div><h3>{t("backupFormat")}</h3><p>{t("restoreConfirm")}</p><div className="modal-actions confirm-actions"><button className="secondary-btn" onClick={onClose}>{t("noCancel")}</button><Button className="danger-btn" variant="danger" onPress={onConfirm}><Download size={15} /> {t("yesConfirm")}</Button></div></div></DialogFrame>;
}
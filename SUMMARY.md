# Tuncard | CardVault Studio — Implementation Summary

## Project classification

**Type:** Educational demo and software-engineering portfolio project  
**Primary purpose:** Demonstrate browser cryptography, TypeScript application structure, validation, browser-local persistence, and interface implementation.  
**Intended data:** Synthetic, non-sensitive sample data only.  
**Production status:** Not production-hardened; not a financial service, certified password manager, or PCI DSS-certified product.

## Application overview

Tuncard | CardVault Studio is a responsive Next.js App Router application built with React and TypeScript. It combines a local card library, a manually maintained TRY transaction journal, an encrypted browser storage model, encrypted backup/restore, a recovery-key workflow, English/Turkish interface copy, and dark/light themes.

There is no custom backend API, server-side database, bank synchronization, payment gateway, or analytics integration in the supplied source. Vault encryption, decryption, validation, and local persistence are implemented in the browser.

## Implemented capability inventory

The following describes functionality visible in the submitted source code. It should not be read as a claim that every runtime path has passed end-to-end verification.

- **Vault lifecycle:** Create and unlock a vault with a master password; manual locking and an idle-lock mechanism; a recovery-code unlock path.
- **Cryptography:** AES-GCM-256 payload encryption through the Web Crypto API; PBKDF2-SHA-256 key derivation with 310,000 iterations in the current record format; independently wrapped data key for the recovery code.
- **Record compatibility:** Parsing support for the v1 encrypted record and migration to the v2 format after a successful master-password unlock.
- **Card library:** Debit, credit, virtual, and gift categories; formatted card-number input; masked previews; card metadata; favorites; tags; search and category filtering; create/edit/delete confirmation flows.
- **Validation:** Required fields, numeric length checks, Luhn-based plausibility checks for non-gift categories, optional expiry-format and expiry-date checks, tag limits, and master-password rules.
- **Manual activity ledger:** Payment, top-up, withdrawal, and refund records; TRY amounts; period and transaction-type filters; activity summary and CSV/print-report flows.
- **Backup and recovery:** Encrypted JSON backup export/restore, master-password rotation, and a user-managed recovery text file.
- **Presentation:** English and Turkish interface copy, dark/light themes, responsive layout, card preview animations, and reduced-motion styles.
- **Baseline browser controls:** Response security headers and Content Security Policy configuration.
- **Tests included in source:** Vitest unit tests for validation and time-range helpers, plus cryptographic vault creation, unlock, recovery, update, and password rotation behavior.

## Module responsibilities

| Module | Responsibility |
| --- | --- |
| `app/page.tsx` | App Router page entry point |
| `app/layout.tsx` | Root layout, metadata, and global styles |
| `app/globals.css` | Visual system, themes, layout, breakpoints, and motion styles |
| `components/vault-app.tsx` | Main UI, state transitions, dialogs, card and transaction workflows, exports, and recovery interactions |
| `lib/crypto.ts` | Web Crypto operations, encrypted-record parsing, unlock and recovery, payload updates, and password re-wrapping |
| `lib/validation.ts` | Card-number formatting/checks, password policy, tag sanitization, and transaction-period filtering |
| `lib/types.ts` | Card, transaction, vault payload, encrypted record, and pending-action types |
| `lib/i18n.ts` | English and Turkish UI strings |
| `tests/crypto.test.ts` | Unit tests for vault cryptography and recovery functions |
| `tests/validation.test.ts` | Unit tests for validation, formatting, and period filtering |
| `next.config.ts` | Next.js runtime settings and response headers |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the repository tree, architecture flow, data lifecycle, and implementation boundaries.

## Quality and verification status

The submitted archive includes a `TEST-REPORT.md` that records some packaging-time checks as completed and explicitly states that the dependency-based Vitest run, full application TypeScript check, ESLint run, and Next.js production build were not verified in that environment because dependency installation could not reach the npm registry.

Do not advertise those checks as passing until they have actually been run successfully against the current working tree. Use the following commands in an environment with dependencies available:

```bash
npm ci
npm run typecheck
npm run typecheck:core
npm run lint
npm test
npm run build
```

## Deliberate scope boundaries

- Synthetic demo data only; not intended for real cardholder or financial information.
- No bank connections, balance retrieval, payment processing, issuer checks, or transaction reconciliation.
- No PIN, CVV/CVC, track-data, OTP, or bank-password fields.
- Browser-local persistence only; no remote database or account synchronization.
- No claim of PCI DSS compliance, security certification, independent audit, or production readiness.

## Intended portfolio outcomes

This repository can be used to discuss client-side cryptography, TypeScript modeling, validation design, browser storage constraints, security trade-offs, test strategy, and UI engineering. Those are learning outcomes and engineering topics, not a claim that the software is suitable for real-world financial-data storage.

# Architecture — Tuncard | CardVault Studio

## 1. Purpose and boundaries

Tuncard | CardVault Studio is a portfolio and educational demonstration of a local-first browser application. Its architectural focus is the interaction between a React interface, typed domain data, client-side cryptographic helpers, validation utilities, and browser-local persistence.

The current repository does not implement a custom backend API, server-side database, bank connector, payment processor, user account service, or analytics pipeline. This boundary keeps the demo's data flow inspectable, but it does **not** make the application production-hardened. Use synthetic, non-sensitive data only.

## 2. High-level component flow

```text
User
 |
 v
Next.js App Router
 app/page.tsx -> components/vault-app.tsx
 |
 +--> lib/i18n.ts       English/Turkish strings
 +--> lib/validation.ts Formatting, plausibility checks, form rules, filters
 +--> lib/types.ts      Domain and encrypted-record contracts
 |
 v
lib/crypto.ts
 |-- PBKDF2-SHA-256 key derivation
 |-- AES-GCM-256 payload encryption/decryption
 |-- data-key wrapping/unwrapping
 |-- encrypted-record parsing and legacy compatibility
 |
 v
Browser Web Crypto API + browser localStorage
```

`components/vault-app.tsx` coordinates the UI and application state. `lib/crypto.ts` is responsible for the encrypted-record lifecycle. `lib/validation.ts` contains deterministic validation and formatting helpers rather than UI state. `lib/types.ts` defines the shapes shared across the UI and crypto module, while `lib/i18n.ts` provides the interface messages.

## 3. Repository map

```text
.
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   └── vault-app.tsx
├── lib/
│   ├── crypto.ts
│   ├── i18n.ts
│   ├── types.ts
│   └── validation.ts
├── tests/
│   ├── crypto.test.ts
│   └── validation.test.ts
├── docs/
│   └── ARCHITECTURE.md
├── README.md
├── SECURITY.md
├── SUMMARY.md
├── TEST-REPORT.md
├── CHANGELOG.md
├── LICENSE
├── package.json
├── package-lock.json
├── next.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── tsconfig.json
├── tsconfig.lib.json
├── vitest.config.ts
├── .env.example
├── .gitignore
└── .npmrc
```

### Module responsibilities

| Path | Responsibility | Notes |
| --- | --- | --- |
| `app/page.tsx` | Root application route | Renders the main vault experience |
| `app/layout.tsx` | Root document layout | Holds document metadata and global stylesheet wiring |
| `app/globals.css` | Visual layer | Global styles, responsive behavior, themes, and animations |
| `components/vault-app.tsx` | UI orchestration | Vault lifecycle, sections, form/dialog state, local persistence calls, and reporting workflows |
| `lib/crypto.ts` | Cryptographic boundary | Key derivation, payload encryption, credential wrapping, parsing, recovery, and record updates |
| `lib/validation.ts` | Deterministic input logic | Card number normalization/formatting, Luhn checks, password policy, tag cleanup, and date-period filtering |
| `lib/types.ts` | Type contracts | Card and transaction models, vault payload, v1/v2 encrypted records, and pending actions |
| `lib/i18n.ts` | Localization | English and Turkish user-facing strings |
| `tests/crypto.test.ts` | Crypto unit tests | Create/unlock, wrong-password handling, recovery, record updates, and password rotation |
| `tests/validation.test.ts` | Validation unit tests | Number formatting, checksum, form checks, password policy, and time filtering |
| `next.config.ts` | Framework configuration | React strict mode, framework header settings, and baseline response headers |

## 4. Vault data model

The decrypted payload is represented by `VaultData` in `lib/types.ts` and currently has `schemaVersion: 1`, a `cards` array, and a `transactions` array.

A `VaultCard` contains application metadata such as its identifier, label, holder, category, provider/bank label, card number, expiry string, visual accent, favorite state, tags, and timestamps. A `LedgerTransaction` contains an identifier, linked card metadata, transaction kind, description, numeric amount, `TRY` currency, occurrence time, and optional note.

Transactions are manual journal entries. They do not originate from a bank feed, and their amounts are not reconciled against an external financial source.

## 5. Encryption and credential lifecycle

The current v2 record format is described by `EncryptedVaultRecordV2` and produced by `lib/crypto.ts`.

1. **Vault creation:** The browser's secure random generator creates a 32-byte DEK and separate random salts for password and recovery-key derivation.
2. **Credential derivation:** PBKDF2-SHA-256 with 310,000 iterations derives AES-GCM wrapping keys from the master password and recovery code independently.
3. **DEK wrapping:** The raw DEK is wrapped twice, each with its own fresh random 12-byte IV. Neither wrapper is the plaintext DEK.
4. **Payload encryption:** The JSON vault payload is encrypted with AES-GCM-256 using the DEK and a fresh random 12-byte payload IV.
5. **Persistence:** The encrypted record, including ciphertext, wrapped DEK values, salts, IVs, and metadata, is serialized to browser `localStorage` under `cardvault.encrypted.v1`.
6. **Unlock:** A credential-derived wrapping key unwraps the DEK, which is then used to decrypt and validate the payload. The decrypted payload and key are kept in memory while the vault is unlocked.
7. **Update:** A vault update encrypts the new payload with a new payload IV before the updated encrypted record is saved.
8. **Password rotation:** The DEK is re-wrapped for the new master password with a newly generated salt and IV. The current implementation does not need to re-encrypt the payload for this operation; the recovery wrapper remains intact.

The imported DEK is marked extractable to support password rotation. This is an implementation trade-off and should be included in any discussion of the threat model.

## 6. Legacy record compatibility

`lib/crypto.ts` can parse legacy `cardvault-encrypted-v1` records and unlock them with the earlier password-derived key design. After a successful unlock, the application creates a v2 record and offers a new recovery-code setup flow. The storage key name remains `cardvault.encrypted.v1` for compatibility even when the serialized record uses the v2 format.

## 7. Local storage, backups, and recovery files

- The vault's active persisted record is held in browser `localStorage`. It is scoped to the browser profile and origin and may be lost if site data is cleared.
- An encrypted JSON backup is an export of the encrypted record, including its credential wrappers and ciphertext. It should still be treated as private data.
- Restoring a backup replaces the existing encrypted record after confirmation. The restored record must be unlocked with credentials that correspond to that backup.
- A recovery text file stores the recovery code in plaintext. Unlike an encrypted backup, this is directly usable as an unlock credential and must be protected as a secret.
- Language and theme settings live in React state and are not persisted across a page reload.

## 8. Validation behavior

`lib/validation.ts` provides deterministic helper functions:

- Card input normalization strips non-digits and truncates input to 19 digits; display formatting groups digits in sets of up to four.
- Non-gift card categories are checked for a supported length, common simple sequences, and the Luhn checksum. Gift entries skip Luhn validation but still have numeric-length checks.
- Card network display is inferred from a small set of known prefixes; it is not a live network lookup.
- Expiry values, when supplied, are expected in `MM/YY` format and checked against the current date.
- Tags are trimmed, de-duplicated, length-limited, and capped at ten.
- The password policy checks length, case, an allowed special character, supported ASCII characters, URL-like values, whitespace through the supported-character rule, and repeated digit runs.
- Transaction-period filtering excludes invalid timestamps and records in the future relative to the supplied current time.

These checks improve input quality but do not verify card issuance, ownership, account status, or transaction authenticity.

## 9. Runtime security configuration

`next.config.ts` disables the powered-by header, enables React strict mode, and configures baseline response headers, including a Content Security Policy, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`.

These settings are defensive defaults. They do not replace dependency review, code review, secure deployment configuration, or independent security testing. The development CSP differs from the production CSP, and this demo should not be described as audited or production-ready.

## 10. Tests and verification boundary

The repository contains `tests/crypto.test.ts` and `tests/validation.test.ts`, configured through Vitest. The tests target deterministic library behavior and encryption-helper workflows. The supplied `TEST-REPORT.md` records packaging-time smoke checks but also states that the dependency-based Vitest suite, complete application type check, lint, and production build were not verified in that environment.

Before claiming that quality gates pass, install dependencies from `package-lock.json` and run:

```bash
npm ci
npm run typecheck
npm run typecheck:core
npm run lint
npm test
npm run build
```

Manual browser testing, accessibility evaluation, dependency auditing, and security review remain separate activities.

## 11. Explicit non-goals

The current source does not implement bank connectivity, payment authorization, balance retrieval, automatic transaction imports, user accounts, cloud synchronization, a backend vault service, PCI DSS compliance, a certified password manager, or an independently audited security boundary.

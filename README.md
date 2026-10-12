# Tuncard | CardVault Studio

**A portfolio-focused demonstration of a local-first, browser-encrypted card organizer and manual transaction journal.**

> [!IMPORTANT]
> **Demo, education, and portfolio use only.** This repository is intended to demonstrate frontend engineering, browser cryptography, data validation, and interface design. Use synthetic or otherwise non-sensitive sample data only. Do not enter real payment-card numbers, personal financial information, PINs, CVV/CVC values, one-time passwords, bank credentials, or other authentication secrets. This is not a production financial application, a certified password manager, or a PCI DSS-compliant product.

Tuncard | CardVault Studio is built with Next.js, React, and TypeScript. It provides a visual card library, a manually maintained transaction ledger, browser-side encryption, encrypted backup and restore, a recovery-key workflow, and English/Turkish interface copy. The source is intentionally organized so the main UI, cryptographic operations, validation helpers, domain types, and tests can be inspected independently.

## Project goals

This project is a learning and portfolio artifact designed to demonstrate how several practical application concerns can be combined in a small, inspectable codebase:

- Client-side encryption with the Web Crypto API.
- Form validation and normalization for structured user input.
- TypeScript domain modeling and a modular utility layer.
- Browser-local persistence, encrypted backup/restore, and recovery flows.
- A responsive interface with reusable dialogs, filtering, theming, and localization.
- Unit tests for cryptography-related helpers, validation rules, and transaction-period filtering.

The project is **not intended to demonstrate a production-ready financial security boundary**. Encryption, tests, or browser security headers do not by themselves make an application suitable for storing real cardholder data.

## Features

### Card library

- Organizes entries into debit, credit, virtual, and gift-card categories.
- Formats entered card digits into groups while typing and masks the number in normal card previews.
- Applies basic length and plausibility checks. Non-gift payment-card categories are checked with the Luhn checksum; gift cards are exempt from that checksum because gift-card numbering conventions vary.
- Performs local, prefix-based card-network labeling without contacting a card-network service.
- Supports card metadata, optional expiry-date validation, favorites, up to ten tags, searching, and category filtering.
- Provides front/back card previews and confirmation dialogs for card creation, editing, and deletion.

> Card-number checks are not issuer verification. A passing checksum does not prove that a card exists, is active, belongs to the user, or can be used for a transaction.

### Manual transaction journal

- Records payments, top-ups, withdrawals, and refunds against a card entry.
- Stores amounts in TRY and allows a description, date/time, and optional note.
- Filters activity by time period and transaction type.
- Provides CSV export and a browser print flow that can be used to save a report as PDF.
- Includes an overview dashboard with activity metrics and visual summaries.

Transactions are entered by the user. The application does not connect to a bank, retrieve balances, authorize payments, or verify that an entry reflects a real transaction.

### Vault access and encryption

- Creates a vault protected by a master password with live password-policy feedback.
- Uses the browser Web Crypto API to encrypt the vault payload with AES-GCM-256.
- Derives wrapping keys using PBKDF2 with SHA-256 and 310,000 iterations in the current format.
- Generates a recovery code that can independently unlock the same vault and offers a text-file recovery workflow.
- Supports changing the master password, encrypted JSON backup export/restore, manual locking, and an idle-lock mechanism.
- Retains compatibility with the earlier v1 encrypted-record format and migrates a v1 vault after successful password unlock.

See [SECURITY.md](SECURITY.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for implementation details and residual risks.

### Interface and developer experience

- Next.js App Router with React and TypeScript.
- English and Turkish interface copy.
- Dark and light themes; selected language and theme are currently session-only and return to their defaults after a reload.
- Responsive layouts, card-preview animations, and reduced-motion styling.
- Baseline response security headers configured in `next.config.ts`.
- Vitest tests for the validation helpers and cryptographic vault functions.

## Technology stack

| Area | Technology | Responsibility |
| --- | --- | --- |
| Application framework | Next.js App Router | Application entry point and local web server |
| UI | React | Interactive views, forms, and dialogs |
| Language | TypeScript | Domain types and static analysis |
| Styling | Tailwind CSS v4 and project CSS | Layout, themes, responsive presentation, and motion |
| UI components | HeroUI | Selected interactive UI primitives |
| Icons | Lucide React | Interface iconography |
| Browser cryptography | Web Crypto API | AES-GCM encryption, PBKDF2 key derivation, secure random values |
| Persistence | Browser `localStorage` | Stores the encrypted vault record on the current browser profile |
| Tests | Vitest | Unit tests for encryption and validation helpers |
| Code quality | ESLint and TypeScript | Linting and type-check commands |

The repository contains no custom application API routes, database service, bank integration, payment gateway, or analytics integration. The Next.js application serves the interface; vault operations and persistence are implemented in the browser.

## Architecture at a glance

```text
Browser
  |
  v
Next.js App Router
  app/page.tsx
  |
  v
VaultApp UI
  components/vault-app.tsx
  |                     \
  |                      +--> lib/i18n.ts (English/Turkish copy)
  |                      +--> lib/validation.ts (normalization and validation)
  |                      +--> lib/types.ts (domain and encrypted-record types)
  v
lib/crypto.ts
  |-- Web Crypto API: PBKDF2-SHA-256
  |-- Web Crypto API: AES-GCM-256
  v
Encrypted vault record
  browser localStorage
```

At a high level, the browser loads the encrypted record, requests a credential to unlock it, decrypts the payload in memory, and re-encrypts updates before writing the updated record to `localStorage`. Exported backups contain the encrypted record, not a plaintext card-list export. Recovery-key text files are different: they contain a credential and must be handled as secrets.

For the detailed module map and data lifecycle, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository structure

```text
.
├── app/
│   ├── globals.css          # Global design system, themes, layout, and responsive styles
│   ├── layout.tsx           # Root layout, metadata, and global CSS import
│   └── page.tsx             # App Router page entry point
├── components/
│   └── vault-app.tsx        # Main vault UI, state, workflows, dialogs, and reports
├── lib/
│   ├── crypto.ts            # Encryption, unlock, recovery, backups, and record parsing
│   ├── i18n.ts              # English and Turkish interface strings
│   ├── types.ts             # Card, transaction, vault, and encrypted-record types
│   └── validation.ts        # Card/password validation, formatting, tags, and filters
├── tests/
│   ├── crypto.test.ts       # Vault encryption, unlock, recovery, and password rotation tests
│   └── validation.test.ts   # Card validation, formatting, password rules, and period-filter tests
├── docs/
│   └── ARCHITECTURE.md      # Architecture, module responsibilities, and data lifecycle
├── .env.example             # Notes that no environment variables are currently required
├── .gitignore               # Ignore rules for local artifacts and secrets
├── .npmrc                   # npm configuration
├── CHANGELOG.md             # Project change history
├── LICENSE                  # MIT license
├── README.md                # Project overview and setup guide
├── SECURITY.md              # Security scope, handling guidance, and threat model
├── SUMMARY.md               # Implementation summary and scope checklist
├── TEST-REPORT.md           # Validation history and outstanding verification steps
├── eslint.config.mjs        # ESLint configuration
├── next.config.ts           # Next.js configuration and response headers
├── package.json             # Dependencies and project scripts
├── package-lock.json        # Locked npm dependency tree
├── postcss.config.mjs       # PostCSS/Tailwind integration
├── tsconfig.json            # Application TypeScript configuration
├── tsconfig.lib.json        # Core-library TypeScript configuration
└── vitest.config.ts         # Vitest configuration
```

## Requirements

- Node.js **22 LTS recommended**. The selected Next.js version requires Node.js 20.9 or later.
- npm 10 or later recommended.
- A current browser with Web Crypto API support.

Use the project on `http://localhost:3000` for local development. Do not expose the app on a public network for real financial-data use.

## Getting started

Run the following commands from the directory containing `package.json`.

```bash
# Install the exact dependency tree recorded in package-lock.json.
npm ci

# Start the development server.
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

On first launch, create a demo vault using a unique test-only master password that meets all displayed rules. The current policy requires 8–16 characters, uppercase and lowercase letters, at least one allowed special character, only supported ASCII characters, and no run of four or more identical digits. Do not reuse a real password.

A 16-character recovery code is presented after vault creation. Copy it or save the offered `.txt` file during setup, then store it somewhere private for the duration of your test. The code is a full vault-unlock credential, not a harmless identifier. For portfolio screenshots or demonstrations, use synthetic data only.

To run a local production build after dependencies have been installed:

```bash
npm run build
npm run start
```

The server normally starts on `http://localhost:3000` unless configured otherwise by the runtime.

## Quality checks

Run the checks from the repository root:

```bash
npm run typecheck
npm run typecheck:core
npm run lint
npm test
npm run build
```

The source archive's `TEST-REPORT.md` records that several lightweight packaging checks completed, but the dependency-based Vitest suite, full application type check, ESLint run, and Next.js production build were not verified in that packaging environment because dependency installation could not reach the npm registry. Run the commands above in an environment where dependencies can be installed, and update the report with the actual results before presenting those checks as passing.

## Data storage and backup behavior

- The encrypted record is stored in the current browser profile under the compatibility key `cardvault.encrypted.v1`.
- Clearing browser site data, changing browser profiles, or using a different device can make the local vault unavailable. Maintain an encrypted backup if you need to preserve demo work.
- The **encrypted JSON backup** contains the encrypted payload and key-wrapping metadata. Restoring it replaces the current local vault after confirmation and it must be unlocked with credentials associated with that backup.
- The **recovery `.txt` file** contains the recovery code in plaintext. Anyone who obtains it can unlock the corresponding vault, so do not commit, publish, or store it beside publicly accessible files.
- Language and theme preferences are not persisted between reloads.

## Known limitations

- This is an educational demonstration and has not undergone an independent security audit or penetration test.
- The app is not PCI DSS certified, is not a payment application, and must not be represented as a secure production vault.
- No real bank synchronization, balance lookup, transaction reconciliation, payment processing, or issuer verification is implemented.
- Card validation performs syntax/plausibility checks only; it cannot establish ownership, issuance, or account status.
- Decrypted content and the imported data-encryption key exist in the active browser context while the vault is unlocked.
- Browser extensions, malware, keyloggers, compromised devices, screen capture, and access to an unlocked browser profile are outside the protection provided by encryption at rest.
- The test suite is not a substitute for browser-level testing, accessibility evaluation, threat modeling, or independent security review.

## Documentation

- [Security policy and threat model](SECURITY.md)
- [Architecture and data lifecycle](docs/ARCHITECTURE.md)
- [Implementation summary](SUMMARY.md)
- [Test report and verification status](TEST-REPORT.md)
- [Change history](CHANGELOG.md)

## License

This project is distributed under the MIT License. See [LICENSE](LICENSE) for the full text.

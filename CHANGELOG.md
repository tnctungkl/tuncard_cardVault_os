# Changelog

Notable project changes are recorded here. This file documents repository functionality and documentation updates; it is not a security certification or release-quality guarantee.

## Unreleased

### Documentation

- Clarified the educational, demo, and portfolio purpose of the project.
- Documented the current module layout, architecture flow, storage lifecycle, and known limitations.
- Separated reported packaging-time checks from quality checks that still require execution in a dependency-enabled environment.
- Explicitly recommended synthetic, non-sensitive demo data only.

### Security communication

- Clarified that browser-side encryption and configured response headers do not imply production readiness or compliance.
- Documented the master password and recovery code as vault-unlock credentials.
- Described residual risks related to browser memory, extensions, malware, local storage, backups, and device access.

## Existing implementation capabilities

The source tree includes the following capabilities; the list records repository scope and does not imply that every flow has been independently verified in a browser.

- Local encrypted vault creation and unlock using the Web Crypto API.
- AES-GCM-256 payload encryption and PBKDF2-SHA-256 key derivation.
- A recovery-code flow and independent data-key wrapping for the recovery credential.
- Compatibility parsing and migration support for the earlier v1 encrypted-record format.
- Master-password rotation, encrypted JSON backup export/restore, manual lock, and idle locking.
- Debit, credit, virtual, and gift card categories with formatted input, masking, plausibility checks, tags, favorites, search, and category filters.
- A manually maintained TRY transaction ledger with period/type filters and CSV/print-report flows.
- English/Turkish interface copy and dark/light presentation themes.
- Validation and cryptography unit-test files, TypeScript check scripts, ESLint configuration, and Next.js response-header configuration.

## Versioning note

The application package currently declares version `1.1.0` in `package.json`. This changelog does not infer release dates or guarantee that the current working tree has passed all quality gates. Update this file with dated entries when maintainers create actual releases.

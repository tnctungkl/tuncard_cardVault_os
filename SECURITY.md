# Security Policy — Tuncard | CardVault Studio

## 1. Scope and intended use

Tuncard | CardVault Studio is a **portfolio, educational, and learning demonstration** of browser-side encryption and local data management. It is not a bank, payment processor, production financial application, certified password manager, or PCI DSS-certified product.

**Use synthetic, non-sensitive sample data only. Do not store real cardholder data or personal financial information in this project.** Do not enter PINs, CVV/CVC values, magnetic-stripe or track data, one-time passwords, bank login credentials, or other authentication secrets. The repository has not undergone an independent security audit or penetration test, and no compliance claim should be inferred from its use of cryptographic APIs.

This document describes the implementation and its known limitations; it is not a security certification or legal/compliance advice.

## 2. Data handling and cryptographic design

The current encrypted record format is `cardvault-encrypted-v2`. The application uses browser Web Crypto APIs and writes the encrypted record to `localStorage` under the compatibility key `cardvault.encrypted.v1`.

At a high level, the current format works as follows:

1. A random 256-bit data-encryption key (DEK) is generated for a new vault.
2. The vault JSON payload is encrypted with AES-GCM-256. A fresh random 12-byte initialization vector (IV) is generated for each payload encryption.
3. The DEK is wrapped independently for the master password and the recovery code.
4. Each wrapping key is derived with PBKDF2-SHA-256 using 310,000 iterations in the current format and its own random 16-byte salt. The DEK wrappers use separate AES-GCM IVs.
5. The serialized record stores ciphertext, wrapped-key values, salts, IVs, format metadata, and an update timestamp rather than the plaintext payload or raw DEK.

The master password is not saved to `localStorage`. The recovery code is not saved there in plaintext either; it is shown during the recovery setup flow and may be copied or saved by the user to a text file. That text file contains the full recovery credential and must be protected accordingly.

The data-encryption key is imported as extractable in the active browser context to support master-password rotation without encrypting the entire payload again. While the vault is unlocked, decrypted vault data and key material are present in application memory.

The code also contains compatibility logic for the previous v1 record format. After a successful master-password unlock of a supported legacy record, the application migrates it to the current v2 format and presents a new recovery-code setup flow.

## 3. Credentials and recovery

- The master password policy currently permits 8–16 characters and requires uppercase and lowercase letters, an allowed special character, supported ASCII characters, no whitespace or URL-like value, and no sequence of four or more identical digits.
- Passwords are not persisted by the application. Choose a test-only password that is unique to this demo and not reused for any real account.
- The 16-character recovery code can unlock the vault independently of the master password. Anyone who obtains the recovery code can access the data it protects.
- Losing both the master password and the recovery code may make the vault unrecoverable. Browser storage can also be cleared or corrupted, so keep encrypted demo backups separately when preservation matters.
- Changing the master password re-wraps the DEK for the new password. The recovery wrapper remains available.
- Restoring a backup replaces the current local vault after confirmation. The restored vault uses the credentials associated with that backup, which may differ from the currently open vault.

## 4. Threat model and residual risk

Encryption at rest is intended to reduce direct plaintext exposure if someone obtains a copy of the stored encrypted record. It does **not** guarantee confidentiality or integrity of the overall device, browser, runtime, or user session.

The implementation does not protect against, among other things:

- Malware, keyloggers, malicious browser extensions, or scripts executing in the same browser context.
- A compromised browser, operating system, or development machine.
- Screen capture, clipboard history, shoulder surfing, or access to the application while unlocked.
- A weak, reused, or disclosed master password, or disclosure of the recovery code.
- Browser profile access, browser storage deletion/corruption, accidental deletion of backup files, or loss of credentials.
- Vulnerabilities in application code, dependencies, the browser, or the Web Crypto implementation.
- The broader risks of handling actual payment-card information in a non-audited demo.

The imported DEK is extractable to support password rotation, and decrypted records are held in JavaScript memory while the vault is unlocked. These are explicit implementation trade-offs, not guarantees of hardware-backed or operating-system-level isolation.

The repository configures baseline response headers and a Content Security Policy in `next.config.ts`. These controls are defense in depth; they are not proof that the application is secure, and the policy is not a substitute for a security review.

## 5. Safe demonstration practices

1. Use invented card names and generated test numbers that are not associated with real people or accounts.
2. Do not enter real PANs, account details, bank login information, PINs, CVV/CVC values, OTPs, or any other authentication secrets.
3. Use a unique demo-only master password. Do not reuse passwords from email, banking, source control, or other services.
4. Treat the recovery `.txt` file as a secret. Do not commit it, upload it to a public issue, or place it in a public portfolio artifact.
5. Keep encrypted backups private and avoid uploading browser-storage dumps, real personal data, credentials, or screenshots that expose sensitive details.
6. Lock the vault when stepping away from the demo and avoid using it on shared or public computers.
7. Install dependencies from the lockfile, keep dependencies reviewed, and run the configured checks before publishing changes.
8. Test all flows with synthetic data before recording screenshots, screen captures, or demo videos.

`.gitignore` helps avoid accidentally tracking some local files, but ignore rules are not a substitute for reviewing `git status` and the staged diff before committing.

## 6. Security reports

Do not place real card numbers, credentials, recovery codes, private financial records, or other sensitive information in public issues or pull requests. When reporting a potential vulnerability, provide the affected version, synthetic test data, reproduction steps, impact, and expected versus observed behavior. Avoid publicly disclosing an exploitable issue before a fix or mitigation has been discussed.

## 7. Security status

No independent audit, penetration test, compliance assessment, or production-readiness review is claimed by this repository. Passing unit tests or local quality commands does not establish security certification or suitability for real financial data.

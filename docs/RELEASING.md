# Releasing & Signing (macOS)

This document explains how to configure the signing keys, build locally, and cut
a signed + notarized release for this fork.

There are **two completely independent signing systems**. Mixing them up is the
most common source of confusion:

| # | System | What it does | Where the public part lives | Where the secret lives |
|---|--------|--------------|-----------------------------|------------------------|
| 1 | **Tauri updater** (minisign) | Signs the auto-update bundles so an installed app trusts the next version | `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` | `TAURI_SIGNING_PRIVATE_KEY` (+ password) |
| 2 | **Apple code signing + notarization** | Lets macOS Gatekeeper run the `.app` without warnings | The `.app` is stamped at build time | Your Apple Developer ID certificate + notarization credentials |

System **#1** is something *you generate yourself*. System **#2** comes from your
**Apple Developer Program** membership ($99/yr).

> The original upstream project's private keys are **not** shared. This fork uses
> its **own** updater key and its **own** Apple credentials. Never reuse another
> project's private keys.

---

## Part 1 — Tauri updater key (minisign)

### What it is

The auto-updater verifies every downloaded update against the public key **baked
into the currently-installed app** (`plugins.updater.pubkey`). Only an update
signed with the matching private key is accepted.

**Consequence:** the keypair must stay **constant across your entire release
line**. Ship v1.0 with key K, and every later version must also be signed with
K, or existing users can no longer auto-update (they'd have to reinstall
manually). Back the private key up somewhere durable (a password manager).

### This fork's key (already generated)

- Public key: committed in `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
- Private key file: `~/.tauri/agent-terminal-updater.key` (generated with an
  **empty** password) — **not** in the repo, keep it secret.

### Generating (or rotating) the key

Only do this to create the key for the first time, or to deliberately rotate it
(which breaks auto-update for all existing installs — avoid unless necessary):

```bash
mkdir -p ~/.tauri
bun tauri signer generate --ci -p "" -w ~/.tauri/agent-terminal-updater.key
chmod 600 ~/.tauri/agent-terminal-updater.key
```

- `-p ""` = no password. To protect it with a password, pass `-p "your-pass"`
  and remember to set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` accordingly.
- This writes the private key to the file and `<file>.pub` alongside it.

Then copy the **public** key into `src-tauri/tauri.conf.json`:

```jsonc
"plugins": {
  "updater": {
    "endpoints": [
      "https://raw.githubusercontent.com/pezzeonline/agent-terminal/release-manifest/latest.json"
    ],
    "pubkey": "<contents of ~/.tauri/agent-terminal-updater.key.pub>"
  }
}
```

The `endpoints` URL must point at **this fork's** `release-manifest` branch — the
CI publishes `latest.json` there after each release (see Part 4).

---

## Part 2 — Apple Developer ID certificate + notarization

You need an active **Apple Developer Program** membership. All values below become
GitHub Actions secrets (Part 3).

### 2.1 Create the Developer ID Application certificate

This is the certificate for distributing an app **outside** the Mac App Store.

1. **Make a Certificate Signing Request (CSR):**
   - Open **Keychain Access** → menu **Certificate Assistant** →
     **Request a Certificate From a Certificate Authority…**
   - Enter your email, leave "CA Email" blank, select **Saved to disk**, save
     `CertificateSigningRequest.certSigningRequest`.
2. **Create the certificate:**
   - Go to <https://developer.apple.com/account/resources/certificates/list>
   - **+** → **Developer ID Application** → Continue → upload the CSR → Continue.
   - Download the resulting `developerID_application.cer`.
3. **Install & export as `.p12`:**
   - Double-click the `.cer` to add it to your **login** keychain (it pairs with
     the private key created by the CSR).
   - In Keychain Access, find **Developer ID Application: Your Name (TEAMID)**,
     expand it, select **both** the certificate and its private key, right-click
     → **Export 2 items…** → save as `certificate.p12` and set an **export
     password** (remember it).

### 2.2 Collect the values

```bash
# Full signing identity string → APPLE_SIGNING_IDENTITY
security find-identity -v -p codesigning
#   e.g.  "Developer ID Application: Your Name (ABCDE12345)"

# Base64 of the .p12 → APPLE_CERTIFICATE  (copied to clipboard)
base64 -i certificate.p12 | pbcopy
```

- **`APPLE_CERTIFICATE`** — the base64 string above.
- **`APPLE_CERTIFICATE_PASSWORD`** — the `.p12` export password from step 2.1.3.
- **`APPLE_SIGNING_IDENTITY`** — the full `Developer ID Application: … (TEAMID)`
  string.
- **`APPLE_TEAM_ID`** — the 10-character team ID (the `(ABCDE12345)` part; also
  shown at <https://developer.apple.com/account> → Membership details).

### 2.3 Notarization credentials

Notarization is Apple's automated malware scan; it must succeed or the app is
quarantined on other Macs.

- **`APPLE_ID`** — your Apple Developer account email.
- **`APPLE_PASSWORD`** — an **app-specific password** (NOT your account
  password). Create one at <https://appleid.apple.com> → **Sign-In and
  Security** → **App-Specific Passwords** → **+**. It looks like
  `abcd-efgh-ijkl-mnop`.

### 2.4 Keychain password

- **`KEYCHAIN_PASSWORD`** — any random throwaway string. CI uses it to unlock a
  temporary keychain on the runner. Generate one with `openssl rand -hex 16`.

---

## Part 3 — GitHub Actions secrets

Add every value under **Repo → Settings → Secrets and variables → Actions →
New repository secret**. The `release.yml` workflow reads exactly these names:

| Secret | System | Source |
|--------|--------|--------|
| `TAURI_SIGNING_PRIVATE_KEY` | Updater | `cat ~/.tauri/agent-terminal-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Updater | the key's password (empty string for this fork) |
| `APPLE_CERTIFICATE` | Apple | `base64 -i certificate.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Apple | `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | Apple | `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | Apple | developer account email |
| `APPLE_PASSWORD` | Apple | app-specific password |
| `APPLE_TEAM_ID` | Apple | 10-char team ID |
| `KEYCHAIN_PASSWORD` | Apple | any random throwaway string |

> Even if a secret is empty (e.g. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` here),
> create it — the workflow references it and an undefined secret can fail the
> signing step.

---

## Part 4 — Cutting a release

The release workflow (`.github/workflows/release.yml`) is **tag-triggered**. It
builds signed + notarized per-arch `.dmg`s (Apple Silicon + Intel) on a
`macos-15` runner, then creates a **draft** GitHub Release with the `.dmg`s, the
updater bundles + `.sig`, and `latest.json`, and publishes `latest.json` to the
`release-manifest` branch. **The release is never auto-published** — you review
and click Publish manually.

Steps:

1. **Bump the version in all three manifests** (keep them in sync):
   - `package.json` → `"version"`
   - `src-tauri/tauri.conf.json` → `"version"`
   - `src-tauri/Cargo.toml` → `version`
   - then refresh the lockfile line: `cargo update -p agent-terminal --manifest-path src-tauri/Cargo.toml` (or edit `src-tauri/Cargo.lock` by hand).
2. **Commit** with the `chore(release)` scope (filtered out of the changelog):
   ```bash
   git commit -am "chore(release): vX.Y.Z"
   ```
3. **Tag and push:**
   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```
   Only `v[0-9]*` tags trigger the workflow.
4. **Wait ~15 min**, then open the **Releases** page, review the draft, and click
   **Publish**.

---

## Part 5 — Building locally

For everyday development you don't need any signing:

```bash
bun install
bun run tauri:dev        # live dev instance (com.irregulab.agent-terminal-dev)
```

To produce a local `.dmg`, the updater signature is still required because
`createUpdaterArtifacts` is enabled. Provide the updater key via env:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/agent-terminal-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""     # empty for this fork's key
bun run tauri:build
```

A local build is **not** Apple-signed/notarized, so on first launch macOS
Gatekeeper will warn — right-click the app → **Open** to run it. Apple signing
only happens in CI (where the `APPLE_*` secrets exist).

The build output lands under
`src-tauri/target/release/bundle/` (`.dmg`, `.app`, `.app.tar.gz`, `.sig`).

---

## Troubleshooting

**`A public key has been found, but no private key. Make sure to set
TAURI_SIGNING_PRIVATE_KEY environment variable.`**
`tauri.conf.json` has an updater `pubkey`, so the build wants the matching
private key to sign the update artifacts. Export it first:
```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/agent-terminal-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
```
In CI, this means the `TAURI_SIGNING_PRIVATE_KEY` secret is missing or empty.

**Existing users don't receive an update.**
The updater pubkey must be identical to the one embedded in their installed
build. If you rotated the minisign key, previously-installed apps will reject
the new signature — they must reinstall once from a fresh `.dmg`.

**Notarization fails / "app is damaged".**
Confirm `APPLE_ID`, `APPLE_PASSWORD` (app-specific, not the account password),
and `APPLE_TEAM_ID` are correct, and that the certificate is a **Developer ID
Application** cert (not "Apple Development" or "Mac App Distribution").

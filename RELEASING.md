# Releasing Zinx Threads (desktop)

The desktop app is packaged with **electron-builder** and distributed via **GitHub Releases**;
installed builds **update themselves** from there through `electron-updater`. Users never download
an installer after the first one.

## What a release contains

`electron-builder --publish always` builds the installers **and** uploads them, plus the
`latest.yml` / `latest-mac.yml` / `latest-linux.yml` update manifests, to a GitHub Release:

| OS      | Artifacts                                                | Self-installs                 |
| ------- | -------------------------------------------------------- | ----------------------------- |
| Windows | `zinx-threads-<version>-setup.exe` (+ `.blockmap`)        | ✅ once signed (Authenticode) |
| macOS   | `zinx-threads-<version>-{arm64,x64}.dmg` + matching `.zip` | ✅ once signed + notarized    |
| Linux   | `zinx-threads-<version>.AppImage` (+ deb)                  | ✅ (AppImage; deb is manual)  |

> **The `.zip` is not optional on macOS.** Squirrel.Mac updates from a ZIP, never a DMG — the DMG is
> only the first-install medium. Both architectures are built because an arm64 Mac cannot fall back
> to an x64 update.

> ⚠ **Signing is what makes auto-update work.** Squirrel (macOS) and NSIS (Windows) refuse to apply
> an update that isn't signed, or whose publisher doesn't match the installed app. Unsigned builds
> still install by hand, but they will never self-update, and macOS Gatekeeper blocks first launch
> (right-click → **Open**) while Windows shows a SmartScreen "unknown publisher" prompt.

## Prerequisites (once)

1. **`.env.local`** with the deployment's `VITE_*` client config (Convex URL/site URL, WorkOS
   client id + redirect, LiveKit URL, app URL). These are baked into the build. For CI, set the
   same values as repo **Variables** (Settings → Secrets and variables → Actions → **Variables**) —
   they are public client config, not secrets.
2. **WorkOS** must have `http://127.0.0.1:9876/callback` registered as a desktop redirect.
3. A **`GH_TOKEN`** with `repo` scope when releasing locally (CI uses the automatic token).
4. **Code signing certificates** — see below.

## Code signing (required for auto-update)

electron-builder reads all of this from the environment; nothing is committed. In CI these are repo
**Secrets** (Settings → Secrets and variables → Actions → **Secrets**), already wired in
`.github/workflows/release.yml`.

### Windows — Authenticode

| Secret                 | What it is                                                    |
| ---------------------- | ------------------------------------------------------------- |
| `WIN_CSC_LINK`         | The code-signing `.pfx`, base64-encoded                        |
| `WIN_CSC_KEY_PASSWORD` | Its password                                                   |

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) | Set-Clipboard
```

An **OV** certificate signs from a file like this. An **EV** certificate lives on a hardware token
or in a cloud HSM and cannot be used this way — for EV, switch to Azure Trusted Signing
(`win.azureSignOptions`). EV clears SmartScreen instantly; OV builds reputation over time.

Once the certificate exists, set `win.publisherName` in `electron-builder.yml` to the certificate's
subject CN **exactly**. A mismatch makes NSIS reject every future update.

### macOS — Developer ID + notarization

| Secret                  | What it is                                                             |
| ----------------------- | ---------------------------------------------------------------------- |
| `MAC_CSC_LINK`          | The **Developer ID Application** certificate `.p12`, base64-encoded     |
| `MAC_CSC_KEY_PASSWORD`  | Its password                                                            |
| `APPLE_API_KEY_BASE64`  | App Store Connect API key (`AuthKey_XXX.p8`), base64-encoded            |
| `APPLE_API_KEY_ID`      | The key's ID (the `XXX` in the filename)                                |
| `APPLE_API_ISSUER`      | The issuer UUID from App Store Connect → Users and Access → Integrations |
| `APPLE_TEAM_ID`         | Your 10-character Apple team ID                                         |

```bash
base64 -i cert.p12 | pbcopy
base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
```

Use a **Developer ID Application** certificate, not "Apple Distribution" — the latter is for the App
Store and cannot be notarized for direct download. `electron-builder.yml` already sets
`hardenedRuntime: true` and `notarize: true`; `build/entitlements.mac.plist` carries the
mic/camera entitlements the hardened runtime needs for voice calls.

## Cut a release

1. Bump the version in `package.json` (e.g. `1.0.0-beta.1`). electron-builder names the artifacts
   and the Release from this.
2. Choose one:
   - **CI (recommended, all 3 OSes):** commit, then tag and push —
     ```
     git tag v1.0.0-beta.1 && git push origin v1.0.0-beta.1
     ```
     `.github/workflows/release.yml` builds Windows + macOS + Linux and uploads to a **draft**
     GitHub Release. Review it, then **Publish**.
   - **Local (Windows only, fastest):**
     ```
     $env:GH_TOKEN="<token>"; pnpm release:win
     ```
     (`release:mac` / `release:linux` exist too, but macOS must build on a Mac and Linux on Linux.)
3. **Publish the draft Release.** This step is not optional: `electron-updater` reads the latest
   **published** release and cannot see a draft, so until you publish, nobody updates.

> ⚠ **Known electron-builder gotcha — duplicate drafts.** When it uploads assets in parallel to a
> release that doesn't exist yet, electron-builder can create **two** draft releases with the same
> `v<version>` tag and split the assets between them (e.g. one gets the `.exe`, the other the
> `.blockmap`). Before publishing, check the Releases page: if you see two drafts for the version,
> keep the one with the `.exe` + `latest.yml`, move any missing asset (like the `.blockmap`) onto
> it, and delete the stray. A published release needs all three: the installer, `latest.yml`, and
> the `.blockmap`.

## Just want an installer to hand out (no auto-update)

`pnpm build:win` (or `build:mac` / `build:linux`) packages the installer into `dist/` **without**
uploading. Ship the file directly; those builds won't auto-update (no manifest published).

## How auto-update behaves

`src/main/updater.ts`, packaged builds only. The user is never sent to a browser and never downloads
an installer:

1. **On launch**, and every 6 hours after, it checks the published Release.
2. A newer version **downloads in the background**. Nothing is asked and nothing blocks.
3. Once staged it **installs on quit** — closing the app and reopening it lands on the new version.
   That is the whole update path for a user who ignores the UI.
4. The title-bar pill lets them take it sooner: **Restart to update** relaunches into the staged
   build immediately. While bytes are still moving it shows `Updating… N%` and isn't clickable, so
   there is never a button that does nothing.
5. Settings → **Startup & tray → Updates** shows the running version and a manual **Check for
   updates**.

A failed check or download surfaces as an **Update failed** pill (click to retry) and is logged; it
can't crash the app. Error text shown to the user is deliberately generic — electron-updater's raw
messages carry URLs and stack traces.

> **Prereleases.** `autoUpdater.allowPrerelease = true` while the version carries a `-beta.N` tag.
> Flip it to `false` in `src/main/updater.ts` at 1.0.0 so stable users stop being offered betas.

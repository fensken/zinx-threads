# Releasing Zinx Threads (desktop)

The desktop app is packaged with **electron-builder** and distributed via **GitHub Releases**;
installed builds **auto-update** from there through `electron-updater`. This is the beta process —
builds are **unsigned** and run against the **dev** Convex backend.

## What a release contains

`electron-builder --publish always` builds the installers **and** uploads them, plus the
`latest.yml` / `latest-mac.yml` / `latest-linux.yml` update manifests, to a GitHub Release:

| OS      | Artifact                                  | Auto-update (unsigned)               |
| ------- | ----------------------------------------- | ------------------------------------ |
| Windows | `zinx-threads-<version>-setup.exe`        | ✅ works                             |
| Linux   | `zinx-threads-<version>.AppImage` (+ deb) | ✅ works                             |
| macOS   | `zinx-threads-<version>.dmg`              | ❌ needs signing — user re-downloads |

> ⚠ **macOS unsigned:** Gatekeeper blocks the DMG on first open (user right-clicks → **Open**),
> and Squirrel refuses to auto-apply unsigned updates. Both are fixed later by an Apple Developer
> ID + notarization (`electron-builder.yml` → `mac.notarize: true`). Windows shows a SmartScreen
> "unknown publisher" prompt until the app builds reputation or is signed.

## Prerequisites (once)

1. **`.env.local`** with the dev deployment's `VITE_*` client config (Convex URL/site URL, WorkOS
   client id + redirect, LiveKit URL, app URL). These are baked into the build. For CI, set the
   same values as repo **Variables** (Settings → Secrets and variables → Actions → **Variables**) —
   they are public client config, not secrets.
2. **WorkOS** must have `http://127.0.0.1:9876/callback` registered as a desktop redirect (already
   done for dev).
3. A **`GH_TOKEN`** with `repo` scope when releasing locally (CI uses the automatic token).

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
3. Publish the draft Release. Existing installs pick up the update on their next launch (Win/Linux).

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

`src/main/updater.ts` checks GitHub Releases on launch and every 6 hours (packaged builds only).
A newer version downloads in the background; the user gets an OS notification and it installs on the
next quit. Nothing here can crash the app — a failed or unsupported check is logged and ignored.

# Deploying Zinx Threads

This is the **web** deployment runbook (the lowest-risk first release — no code
signing / notarization / auto-update). Desktop packaging is a later milestone
(see the end). For local setup + where each key comes from, see `SETUP.md` and
`.env.sample`.

The app is a **static SPA** (`out/web`) that talks directly to:

- **Convex** — realtime data + auth verification
- **WorkOS AuthKit** — sign-in
- **Cloudflare R2** — file uploads (avatars, logos, attachments, page covers)
- **LiveKit** — voice / video / screen-share
- **Resend** — invitation emails

All the secrets live on the **Convex deployment**, never in the browser bundle.
The only values baked into the web build are the `VITE_*` ones (all public).

---

## 0. Hosting & domain (recommended: Cloudflare Pages)

**Cloudflare Pages** is a great fit: free, fast static hosting, and it gives you a
free `https://<project>.pages.dev` origin **immediately** — you do **not** need to
buy a domain to deploy. Launch on `pages.dev`, attach a custom domain later.

- **Now:** deploy → get `zinx-threads.pages.dev` (or similar). Use that origin
  everywhere below.
- **Later:** buy a domain (Cloudflare Registrar is cheapest/at-cost), add it as a
  **Custom domain** in the Pages project, then update `VITE_APP_URL`, WorkOS
  redirect/CORS, and Convex `APP_URL` to the new origin and redeploy.

> Wherever this doc says `<APP_ORIGIN>`, use your `pages.dev` origin now and your
> custom domain later. **`https://`, no trailing slash.**

---

## 1. Provision the backend services

### 1a. Convex (production deployment)

```bash
npx convex deploy          # creates/pushes the prod deployment; note its URL
```

The prod URL looks like `https://<name>.convex.cloud` → that's your
`VITE_CONVEX_URL`. Crons (notification retention) + the rate limiter deploy with it.

### 1b. WorkOS (production environment)

In the WorkOS dashboard, switch to the **Production** environment and:

- **Redirects** → add `<APP_ORIGIN>/callback` (web) and `zinx://callback` (desktop, for later).
- Copy the **Client ID** (`client_…`) and **API key** (`sk_…`).
- The JWT template/issuer is already wired via `convex/auth.config.ts`.

### 1c. Cloudflare R2 (uploads)

- Create a bucket + an API token (Object Read & Write).
- Enable **public access** (r2.dev subdomain) or attach a custom domain → that's
  `R2_PUBLIC_URL`. Without it, uploads fall back to 7-day signed URLs (not permanent).
- Add a **CORS rule** allowing `PUT` from `<APP_ORIGIN>` (see `SETUP.md` for the JSON).

### 1d. LiveKit (voice/video)

- Use **LiveKit Cloud** (free tier → `wss://<proj>.livekit.cloud`) or self-host
  `livekit-server` (Docker) behind a `wss://` origin.
- Copy the API key + secret.
- If self-hosting on a custom `wss://` host, **add that origin to the CSP
  `connect-src`** in `src/renderer/index.html` (LiveKit Cloud is already allowed
  via `wss://*.livekit.cloud`).

### 1e. Resend (invite emails)

- Verify the sending domain, set `EMAIL_FROM` to an address on it.

---

## 2. Set the environment variables

### 2a. Convex deployment secrets (server-side — never in the browser)

```bash
npx convex env set WORKOS_CLIENT_ID        client_...
npx convex env set WORKOS_API_KEY          sk_...
npx convex env set KLIPY_API_KEY           ...
npx convex env set UNSPLASH_ACCESS_KEY     ...
npx convex env set R2_TOKEN                ...
npx convex env set R2_ACCESS_KEY_ID        ...
npx convex env set R2_SECRET_ACCESS_KEY    ...
npx convex env set R2_ENDPOINT             https://<account>.r2.cloudflarestorage.com
npx convex env set R2_BUCKET               <bucket>
npx convex env set R2_PUBLIC_URL           https://<public-r2-domain>
npx convex env set LIVEKIT_API_KEY         ...
npx convex env set LIVEKIT_API_SECRET      ...
npx convex env set RESEND_API_KEY          re_...
npx convex env set EMAIL_FROM              "Zinx Threads <contact@yourdomain>"
npx convex env set APP_URL                 <APP_ORIGIN>
```

(Only `WORKOS_WEBHOOK_SECRET` / `RESEND_WEBHOOK_SECRET` are optional — needed only
for SCIM sync / delivery-event webhooks.)

### 2b. Frontend build vars (public — set in the Cloudflare Pages project)

```
VITE_CONVEX_URL          https://<name>.convex.cloud
VITE_WORKOS_CLIENT_ID    client_...            # same value as WORKOS_CLIENT_ID
VITE_WORKOS_REDIRECT_URI <APP_ORIGIN>/callback
VITE_LIVEKIT_URL         wss://<livekit-host>
VITE_APP_URL             <APP_ORIGIN>          # invite/connect links break without this
```

---

## 3. Deploy the web app to Cloudflare Pages

**Option A — Git integration (recommended).** Connect the repo; set:

- Build command: `pnpm build:web`
- Output directory: `out/web`
- Environment variables: the `VITE_*` block from 2b
- (Node 20+; pnpm is auto-detected from `pnpm-lock.yaml`)

**Option B — Direct upload (Wrangler).**

```bash
pnpm build:web
npx wrangler pages deploy out/web --project-name zinx-threads
```

Already in the repo for Pages:

- `src/renderer/public/_redirects` → SPA fallback (`/* /index.html 200`) so deep
  links don't 404.
- `src/renderer/public/_headers` → `nosniff` / `Referrer-Policy` / `X-Frame-Options`.

After the first deploy, note the `pages.dev` origin and make sure it matches
`<APP_ORIGIN>` in every step above (WorkOS redirect, `VITE_APP_URL`, Convex
`APP_URL`, R2 CORS). Re-set + redeploy if you started with a placeholder.

---

## 4. Runtime verification (do NOT skip — these were only build-verified)

Walk through each once against the real services:

- [ ] **Auth**: sign in via WorkOS → lands back in the app, user row created.
- [ ] **Workspace**: create a workspace, create channels/groups, send messages.
- [ ] **Uploads (R2)**: set an account avatar + workspace logo + send a file
      attachment + set a page cover. Confirm they persist + reload (public URL).
- [ ] **Voice (LiveKit)**: join a voice channel from two browsers; check mic,
      camera, screen-share, deafen.
- [ ] **Shared channels**: share a channel to a second workspace, accept, post,
      cross-workspace @mention. (Needs two workspaces.)
- [ ] **Email (Resend)**: send a member invite + a channel-share invite; confirm delivery.
- [ ] **Invite links**: open `<APP_ORIGIN>/invite/<code>` in a fresh session.
- [ ] **Offline**: `/local` — create a workspace, page, board; reload; confirm persistence.
- [ ] **Deep-link 404 check**: hard-refresh on `/w/<slug>/<channel>` → no 404 (SPA fallback works).

---

## 5. Desktop release (later milestone — optional)

Not needed for the web launch. When you want installers:

- **Code signing**: Windows (a cert) + macOS (`notarize: true` + Apple Developer ID).
- **Auto-update**: currently NOT wired — `electron-updater` is a dependency but
  `src/main/index.ts` never calls `autoUpdater`, and `electron-builder.yml` /
  `dev-app-update.yml` still point at the placeholder `https://example.com/auto-updates`.
  Wire `autoUpdater` to a real feed (GitHub Releases / R2) before shipping installers.
- **`electron-builder.yml`**: replace `linux.maintainer` + `publish.url` placeholders.
- Build: `pnpm build:win` / `build:mac` / `build:linux`.

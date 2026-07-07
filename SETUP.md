# Backend setup — Convex + WorkOS AuthKit

The app currently runs on **mock data** (`src/renderer/src/data/workspaces.ts`).
This wires the real backend: **Convex** (data + realtime) with **WorkOS AuthKit**
(auth; enterprise SSO/SCIM bolt on later per-connection). It's the same for the
**desktop (Electron)** and **web** targets — one codebase.

> Why the code below isn't already "live": the client packages (`convex`,
> `@workos-inc/authkit-react`, the Convex WorkOS component) are early `0.x`, and
> the supported install path is the Convex CLI, which **provisions your accounts**
> (a managed WorkOS team + Convex deployment) and **auto-writes env vars**. That
> needs your login, so it's a you-step. The backend config files
> (`convex/schema.ts`, `convex/auth.config.ts`, `convex/convex.config.ts`) are
> already scaffolded and SSO-ready.

---

## 1. Create accounts

- **Convex** — https://convex.dev (free).
- **WorkOS** — https://workos.com (AuthKit free up to 1M MAU). Enterprise SSO +
  SCIM are paid per **production** connection (~$125 each) but **free to build/
  test** in a staging environment.

## 2. Install packages

On this machine `pnpm add` can hit an EPERM lock — if so, add these to
`package.json` `dependencies` by hand, then run `pnpm install`:

```
convex                        ^1.42.1
@workos-inc/authkit-react     ^0.16.1
@convex-dev/workos-authkit    ^0.2.7
```

(Or let the CLI do it: `npm create convex@latest` and pick **AuthKit (WorkOS)**,
the default — it installs the right packages and provisions a managed WorkOS team.)

## 3. Start Convex (provisions + writes VITE_CONVEX_URL)

```
npx convex dev
```

First run logs you in, creates a dev deployment, generates `convex/_generated/`,
and writes `CONVEX_DEPLOYMENT` + `VITE_CONVEX_URL` into `.env.local`.

## 4. Put the keys where they belong (details in `.env.sample`)

**Convex deployment (secrets)** — `npx convex env set …`:

```
npx convex env set WORKOS_CLIENT_ID     client_xxx
npx convex env set WORKOS_API_KEY       sk_xxx
npx convex env set WORKOS_WEBHOOK_SECRET wh_xxx      # once you enable sync/SCIM
```

**Frontend** — copy `.env.sample` → `.env.local` and fill:

```
VITE_CONVEX_URL=…            # auto-written by `convex dev`
VITE_WORKOS_CLIENT_ID=client_xxx
VITE_WORKOS_REDIRECT_URI=http://localhost:5173/callback
```

All WorkOS values come from the WorkOS dashboard → **Get started / Quick start**
(client id + API key), **Webhooks** (signing secret), **Redirects** (register the
callback URL), and **Authentication → Sessions → CORS** (add `http://localhost:5173`).

## 5. Wire the client provider

Wrap the router in `src/renderer/src/main.tsx` **only when configured**, so the app
still runs on mock data before the backend exists:

```tsx
import { ConvexReactClient } from 'convex/react'
import { AuthKitProvider, useAuth } from '@workos-inc/authkit-react'
import { ConvexProviderWithAuthKit } from '@convex-dev/workos-authkit/react'
// ^ confirm this import against the installed package's README — the 0.x
//   Convex WorkOS packages have moved the provider export between versions.

const convexUrl = import.meta.env.VITE_CONVEX_URL
const app = <RouterProvider router={router} />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {convexUrl ? (
      <AuthKitProvider
        clientId={import.meta.env.VITE_WORKOS_CLIENT_ID}
        redirectUri={import.meta.env.VITE_WORKOS_REDIRECT_URI}
      >
        <ConvexProviderWithAuthKit client={new ConvexReactClient(convexUrl)} useAuth={useAuth}>
          {app}
        </ConvexProviderWithAuthKit>
      </AuthKitProvider>
    ) : (
      app // mock-data mode — no backend configured yet
    )}
  </StrictMode>
)
```

## 6. Run

- **Web:** `pnpm dev:web` → http://localhost:5173 (redirect login works out of the box).
- **Desktop:** `pnpm dev`.

---

## Desktop (Electron) auth — the one extra step

Hosted redirect login (WorkOS/any IdP) assumes a browser redirect. In Electron the
renderer loads over `file://`, so `http://localhost:5173/callback` isn't a real
page. Handle it with a **custom protocol** (deep link):

1. Register a scheme in the main process — `app.setAsDefaultProtocolClient('zinx')`.
2. Set `VITE_WORKOS_REDIRECT_URI=zinx://callback` for the desktop build and
   register `zinx://callback` in WorkOS → Redirects.
3. Open the WorkOS login in the system browser (`platform.openExternal(...)`),
   catch the `zinx://callback?...` deep link in main (`open-url` on macOS /
   `second-instance` argv on Windows/Linux), and forward the code to the renderer
   over IPC to complete the AuthKit exchange.

This is desktop-only glue; the web target needs none of it. Deferred until auth
is actually turned on.

---

## Enterprise SSO / SCIM (later)

Nothing to build now. When a customer needs it: create a WorkOS **Organization**,
store its id on `workspaces.organizationId`, enable the SSO connection + Directory
Sync in the WorkOS dashboard, point the sync webhook at the Convex component, and
map SCIM groups → `roles` via `roles.groupKeys`. The schema already accounts for
all of this.

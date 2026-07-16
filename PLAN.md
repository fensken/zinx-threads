# PLAN.md — Zinx AI Agent + Bot Platform

> Status: **design, not yet built.** This is the durable spec so we don't lose the
> shape. Build order is in §10. When a phase lands, check it off + move the detail
> into `CLAUDE.md` / a memory.

---

## 0. TL;DR

A **desktop-only AI agent in the right sidebar** that uses the user's **existing
Claude / ChatGPT / Gemini subscription** — by orchestrating each provider's **local
CLI** (the [T3 Code](https://github.com/pingdotgg/t3code) pattern), not by calling a
hosted API. It works in **online workspaces AND offline workspaces** (the CLIs run
locally, so offline is actually the purest case). On the **web** build it renders a
"desktop only" state.

Everything the agent can _do_ to a workspace goes through a single **capability
layer** — a stable, permission-gated set of operations exposed to the agent over
**MCP**. That same layer is the foundation for **Zinx bots** (Slack/Discord-style)
later: a bot is just another _principal_ calling the same capabilities.

**This is a headline selling point:** "bring the AI subscription you already pay
for — no extra API bill — and it has full context of your workspace and can act in
it." No competitor ties team chat to your own Claude/ChatGPT/Gemini plan.

---

## 1. Why this exact shape (the hard constraints)

- Consumer subs (Claude Pro/Max, ChatGPT Plus/Pro, Gemini) **cannot** be billed
  through a hosted backend's API calls. The only sub-reusing path is each
  provider's **local CLI**, which authenticates to the sub via its own OAuth login
  and runs on the user's machine.
- Therefore the agent loop **runs locally** and is **desktop-only** (a browser
  can't spawn `claude`/`codex`/`gemini` or read their credentials).
- Because it's local, it **doesn't need the network** for the model — so it slots
  naturally into offline workspaces too.

| Path                                    | Web | Desktop | Uses their sub | Chosen              |
| --------------------------------------- | --- | ------- | -------------- | ------------------- |
| BYOK API keys (hosted agent)            | ✅  | ✅      | ❌             | later, maybe        |
| **Spawn local provider CLIs (T3 Code)** | ❌  | ✅      | ✅             | **YES (this plan)** |
| Expose Zinx as external MCP server      | ✅  | ✅      | ✅             | later (§6 reuse)    |

> **Correction vs the earlier idea of using `@convex-dev/agent` for the model loop:**
> with the local-CLI approach the **CLI _is_ the agent loop** (it calls the model on
> the sub, does tool-calling, and streams). So we do **not** use the Convex Agent
> component to call models. We use **MCP + our capability layer**, and optionally
> `@convex-dev/rag` for semantic workspace search. Convex Agent could still store
> assistant history, but that's not its strength here; a plain table is simpler.

---

## 2. Architecture — four layers

```
┌───────────────────────────────────────────────────────────────────────┐
│  RENDERER  (Assistant panel — right sidebar, like members/threads)      │
│   • prompt input, streamed transcript, tool-call cards, approvals       │
│   • online: Convex client · offline: local store                        │
└───────────────▲───────────────────────────────────────────▲────────────┘
                │ IPC (start turn, stream events, approvals)  │ IPC (exec capability)
┌───────────────┴───────────────────────────┐   ┌────────────┴────────────┐
│  MAIN  ── (3) Provider adapters            │   │  (4) Capability executor │
│   spawn CLI headless, stream JSON events   │   │   dispatches a tool call │
│   ── (2) Local MCP server (loopback)       │◄──┤   to the right backend   │
│   the CLI connects here for tools          │   └────────────┬────────────┘
└───────────────▲────────────────────────────┘                │
                │ MCP (loopback http/stdio)      ┌─────────────┴─────────────┐
        ┌───────┴────────┐                        │  (1) CAPABILITY LAYER      │
        │ provider CLI    │  ← uses the user's    │  online → Convex functions │
        │ claude / codex  │    subscription        │  offline → local store     │
        │ / gemini        │                        │  (principal-aware, gated)  │
        └─────────────────┘                        └────────────────────────────┘
```

1. **Capability layer** — the tools the agent (and future bots) can call. The
   reusable core. §5.
2. **MCP server** — exposes the capability layer to the spawned CLI as MCP tools. §4.
3. **Provider adapters** — detect + spawn + stream each CLI (T3 Code core). §3.
4. **Assistant UI** — the right-sidebar panel. §8.

---

## 3. Provider adapters — the T3 Code core (`src/main/agent/`)

Main-process only (Node). One adapter per provider behind a common interface, so
the rest of the app never learns a CLI's quirks.

```ts
interface ProviderAdapter {
  id: 'claude' | 'codex' | 'gemini'
  displayName: string
  // Is the CLI installed + logged in? (which/where + a `--version` probe)
  detect(): Promise<{ installed: boolean; loggedIn: boolean; version?: string }>
  // Build argv for a HEADLESS, streaming, MCP-attached run.
  buildInvocation(input: {
    prompt: string
    mcpConfigPath: string // points the CLI at our loopback MCP server
    cwd: string
    systemPreamble: string // "you are Zinx's assistant for workspace X…"
  }): { command: string; args: string[]; env: NodeJS.ProcessEnv }
  // Parse one line/chunk of the CLI's JSON stream into a normalized event.
  parseEvent(chunk: string): AgentEvent[]
}

type AgentEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; args: unknown }
  | { type: 'tool-result'; id: string; ok: boolean }
  | { type: 'thinking'; text: string }
  | { type: 'done'; usage?: unknown }
  | { type: 'error'; message: string }
```

Per-provider invocation (flags drift with versions → the adapter is the only place
that knows them; probe `--version` and adapt):

- **Claude Code** (`claude`): `claude -p "<prompt>" --output-format stream-json
--verbose --mcp-config <file> --allowedTools "mcp__zinx__*" --permission-mode …`.
  Auth = the user's Claude sub (from `claude` login) or `ANTHROPIC_API_KEY`.
- **Codex CLI** (`codex`): `codex exec "<prompt>" --json` with an MCP server
  configured (temp `config.toml` / `-c mcp_servers.zinx=…`). Auth = `codex login`
  (ChatGPT sub) or `OPENAI_API_KEY`.
- **Gemini CLI** (`gemini`): `gemini -p "<prompt>"` (+ JSON output where supported)
  with `mcpServers` in a temp settings file. Auth = Google login or `GEMINI_API_KEY`.

Spawning: `child_process.spawn` with piped stdio (headless mode streams over pipes —
**no `node-pty` needed** unless we later want an interactive terminal view).
Lifecycle: one child per "turn" (or a persistent session per thread — decide in
Phase 1); kill on cancel; surface non-zero exits as `error` events.

IPC surface (preload → `platform.agent`):
`agent.detectProviders()` · `agent.startTurn({threadId, provider, prompt})` ·
`agent.cancel(turnId)` · `agent.onEvent(cb)` · `agent.approve(callId, decision)`.

---

## 4. Tools over MCP, not stdout scraping (`src/main/agent/mcp-server.ts`)

Main hosts a **local MCP server bound to `127.0.0.1`** (loopback only, ephemeral
port, per-session bearer token in the generated config). Each spawned CLI is handed
an MCP config pointing at it, so the model gets **structured tools** instead of us
guessing from prose.

Why MCP (not parsing the CLI's free text):

- All three CLIs speak MCP → one integration, not three bespoke parsers.
- The **same MCP surface** is reusable for external connectors and bots (§6).
- Tool calls are typed + auditable → clean approval gating (§9).

The MCP server is thin: each MCP tool = one **capability** (§5). On a tool call it:

1. (writes only) asks the renderer to show an **approval card**, awaits the user;
2. dispatches to the capability executor;
3. returns structured JSON to the CLI.

Deps: `@modelcontextprotocol/sdk` (server). Transport: prefer **streamable-http on
loopback** (simplest for an in-process server with direct state access); stdio is
the fallback.

---

## 5. The capability layer — the reusable core (`convex/capabilities/` + offline mirror)

A **stable, documented, permission-gated** catalog of operations. This is the API
"for non-human callers." Design rules:

- **Principal-aware.** Every call carries a principal: `{ kind: 'user'|'bot', id }`.
  The agent runs **as the signed-in user**; a future bot runs as itself. Permissions
  are always re-checked for that principal via the existing `lib/auth.ts`
  (`getChannelAccess` / `getMembership`) — **the agent can never exceed what its
  principal can do.**
- **Structured, LLM-friendly returns.** Return human names (channel/author names),
  timestamps, and short text — plus the `id`s needed for follow-up calls. Never make
  the model guess an id; never surface an id as the _only_ label (per the "no raw
  ids in UI" rule — but the agent may pass ids back into tools).
- **Two backends, one interface.** Online → **Convex functions**; offline → the
  **local store**. Same tool names + shapes, so the MCP server + UI don't branch.
- **Reads auto-run; writes are confirmation-gated** (§9).

### Initial catalog

Read (safe, auto-run):

- `search_messages({ query, channelId?, limit })` → matches (text, author, channel, ts, messageId)
- `list_channels()` · `get_channel({ channelId })` · `list_members()` · `find_member({ query })`
- `read_page({ channelId })` → title + Markdown-ish text · `list_board({ channelId })` → columns + tasks
- `get_thread({ threadId })` · `list_unread()` · `get_recent({ channelId, limit })`
- `who_am_i()` → the principal's identity + workspace + role

Write (confirmation-gated):

- `post_message({ channelId, body, replyToId? })` · `reply_in_thread({ threadId, body })`
- `create_page({ name, markdown? })` · `append_to_page({ channelId, markdown })`
- `create_task({ channelId, columnId, title, … })` · `move_task({ taskId, toColumnId })`
- `create_channel({ name, kind, groupId? })` (gated to owner/admin)

Online implementation (`convex/capabilities/*.ts`):

- Thin wrappers that reuse existing domain logic (`messages.send`, `pages.saveContent`,
  `boards.createTask`, …) but with a **principal arg** + structured returns + rich
  descriptions. Group under one namespace so the MCP server enumerates them.
- Callable by: the desktop agent (user token from the main-process vault), future
  bots (bot token), external MCP.

Offline implementation (`src/renderer/src/lib/capabilities-local.ts`):

- Same names/shapes over `store/local-store.ts`. No auth (single user, single device).
- Executed in the renderer (it owns the live store); main's MCP server reaches it via
  IPC. Writes go through the store actions → auto-persist to the on-disk folders.

Execution routing:

- **Online:** MCP server (main) → Convex with the user's token (main holds the vault)
  **or** → renderer → Convex client. MVP: route through the renderer for one code
  path + live reactivity; bots later call Convex directly.
- **Offline:** MCP server (main) → renderer → local store.

---

## 6. Bot platform foundation (design now, build later)

Bots reuse §5 with a **bot principal**. Schema to anticipate (add when we build it):

- **`botUsers`** — `workspaceId` / `name` / `avatar` / `createdBy` / `scopes[]`.
  A bot is a first-class author (like the old demo users): messages it posts render
  with a **BOT badge** (Discord/Slack style).
- **`botTokens`** — hashed secret + `botUserId` + `scopes` (which capabilities). The
  capability layer checks scope ∩ permission.
- **Events / webhooks** (`botSubscriptions`) — bots subscribe to `message.created`,
  `mention`, `thread.reply`, etc. `convex/lib/notifications.ts` `fanOutNotifications`
  already computes "who cares about this message" — extend it to also enqueue **bot
  deliveries** (an outbound webhook via a Convex action, or a poll endpoint).
- **Bot API** = the §5 capabilities exposed as authenticated Convex functions / HTTP
  actions. A bot = headless principal calling the same tools the agent calls.

So the through-line: **capability layer → { MCP for the local agent, HTTP/Convex for
bots, MCP for external connectors }**. Build it once, principal-agnostic, and all
three fall out.

---

## 7. Offline support

The agent is arguably _most_ at home offline: everything is local already.

- Same Assistant panel in the `/local` shell (add the right-panel slot there).
- Capabilities target the **local store** (`capabilities-local.ts`); no Convex, no auth.
- CLI orchestration is **identical** to online (it was always local).
- Follows `offline-parity-rule` (memory): a feature that can run without a server
  must exist offline too.

---

## 8. UI — right-sidebar Assistant (`components/agent/`)

- New right-panel mode alongside members/thread (`WorkspaceRightPanel` already
  switches; add `assistant`). Header button + quick-nav entry ("Assistant").
- **Presentation via Vercel AI Elements-style** components (Conversation, Message,
  Response, Reasoning, Tool, PromptInput) adapted to our Base UI/base-nova theme.
  Data comes from our IPC event stream (not the AI SDK's `useChat` — the CLI streams
  through main).
- Streamed transcript, **tool-call cards** (name + args + result), **approval cards**
  for writes (Approve / Deny / Always-allow-this-tool-this-session).
- **Provider picker** (Claude / ChatGPT / Gemini) with login/detected status.
- **Web build:** a "Zinx Assistant is desktop-only — download the app" empty state
  (`platform.isWeb`). **Desktop without any CLI:** an onboarding state with
  per-provider install/login instructions (à la T3 Code).
- Settings: a new **Assistant** section — detected CLIs, default provider, permission
  policy (auto-approve reads / confirm writes / confirm everything).
- Thread storage: online → a `assistantThreads`/`assistantMessages` Convex table
  (cross-device history); offline → local store. (Convex Agent component optional; not
  required since the model loop is the CLI.)

---

## 9. Security model (an acting agent is a real surface)

- **Least privilege by construction:** the agent is a principal; every capability
  re-checks that principal's permissions server-side (online) — reusing the audited
  `getChannelAccess`/`getMembership` gates. Offline is single-user/local.
- **Writes require explicit approval** at the MCP boundary before executing (renderer
  approval card). Default policy: auto-run reads, confirm writes. Destructive ops
  (delete) always confirm.
- **MCP server is loopback-only** (`127.0.0.1`, ephemeral port) with a per-session
  bearer token in the generated config — never exposed on the network.
- **No secrets in the renderer.** CLI auth lives in each CLI's own local store; any
  Convex token used by the MCP server comes from the main-process vault.
- **Bots** get scoped tokens; scope ∩ permission is the ceiling. Bot actions are
  attributed (BOT badge) and auditable.
- Respect existing non-negotiables: `contextIsolation`/`sandbox`, narrow preload,
  validate every IPC input in main (esp. capability names + args from the CLI).

---

## 10. Build order (phased)

- [x] **Phase 0 — Capability layer (read set).** `convex/capabilities/read.ts` —
      `whoAmI` · `listChannels` · `listMembers` · `searchMessages` · `getRecentMessages`
      · `readPage` (BlockNote→text) · `listBoard`. Member/`getChannelAccess`-gated,
      structured LLM-friendly returns (names + ISO times + ids for follow-ups), honors
      the guest share cut-off. Tests in `convex/capabilities.test.ts` (5, all green).
      Principal = the signed-in user for now; a bot principal slots in at Phase 6.
      _(Write set + a shared principal helper come with Phase 3.)_
- [x] **Phase 1 — Main-process agent core.** `src/main/agent/` — `providers.ts`
      (Claude + Codex + Gemini adapters: detect / headless invocation w/ MCP config /
      JSON-stream parse), `mcp-server.ts` (loopback StreamableHTTP MCP server, bearer
      token, tools → dispatch), `index.ts` (`registerAgentIpc`: detect / start / cancel,
      spawn + stream, dispatch to Convex online via `ConvexHttpClient` +
      `makeFunctionReference`, offline via renderer IPC, write-approval gate). Token from
      main's vault (`auth.ts` `getToken` now exported). ⚠ **NOT runtime-verified** — CLI
      flags/JSON shapes need checking against the installed CLIs.
- [x] **Phase 2 — Assistant panel.** `components/agent/agent-panel.tsx` (transcript,
      tool chips, approval cards, provider picker, web "desktop-only" + "no CLI"
      states) + `agent-bridge.tsx` (wires the IPC stream/approvals/offline-exec into
      `store/agent-store.ts`) + `platform.agent`. Right-panel mode in `WorkspaceRightPanel`
      (outranks thread + members) + a Sparkle toggle in the channel header (desktop-gated).
- [x] **Phase 3 — Write capabilities + approval gating.** `convex/capabilities/write.ts`
      (`postMessage`/`replyInThread`/`createChannel`/`createTask` — action wrappers over
      the real mutations via `ctx.runMutation`, so all logic/gates stay intact). Writes
      are confirmation-gated at the MCP dispatch (approval card in the panel). Tests green.
- [x] **Phase 4 — Offline.** `lib/capabilities-local.ts` (read+write subset over the
      local store) + the Assistant panel in the `/local` shell + an "Assistant" quick-nav
      item. Offline tool exec routes main → renderer → local store.
- [x] **Phase 5 — Gemini.** Gemini adapter shipped alongside Claude + Codex in `providers.ts`.
- [x] **Phase 6 — Bot platform (foundation).** Bots = `users` rows (`provider: 'bot'`) +
      `botTokens` (SHA-256) — `convex/bots.ts` `create`/`listByWorkspace`/`revoke`/`post`
      (token-auth action) + `internalPost`; `isBot` flows through `enrichMessages` for a
      BOT badge. Tests green. **Deferred:** bot-management UI, scopes, event fan-out to bots.

Each phase: `pnpm typecheck && pnpm lint && pnpm test`; Convex changes →
`npx convex dev --once`; UI changes → say what to verify.

**Overall status (2026-07-13):** all phases build/typecheck/lint/test green (39 tests) +
Convex pushed + both desktop & web builds pass. The whole **agent runtime is NOT yet
verified against a real CLI** — the provider flags + JSON-event shapes in `providers.ts`
are best-effort per each CLI's docs and will need tuning once `claude`/`codex`/`gemini`
are installed and driven end-to-end.

---

## 10a. vs t3code (reference impl) — verified 2026-07-13

Pulled t3code's actual source. Shared: **Electron** desktop (they're on Electron 41), spawn the user's local CLI to reuse their sub, desktop-only. **Where t3code is more robust:** it talks to agents over their **native structured protocols** — **ACP (Agent Client Protocol)**, JSON-RPC over stdio, for Claude/Gemini (`packages/effect-acp`) and the **Codex app-server** protocol for Codex (`packages/effect-codex-app-server`) — not raw CLI flags + stdout parsing. ACP is the _intended_ programmatic interface: versioned, and it natively carries streaming, tool-permission prompts, session continuity, **and auth state** (the agent tells the client when it needs to authenticate). t3code is also built on **Effect** (heavy FP runtime) and supports **remote agents over SSH/Tailscale** (`packages/ssh`,`/tailscale`) — a dimension we don't need.

**DONE (2026-07-13) — transport migrated to ACP, matching t3code.** We now drive agents with the official **`@zed-industries/agent-client-protocol`** client (`src/main/agent/index.ts`): spawn the provider as an ACP agent, `ndJsonStream` over its stdio, `initialize → newSession(mcpServers:[our http MCP]) → prompt`, map `sessionUpdate` → our events, answer `requestPermission`, `authenticate` on `auth_required`. Protocol-correct **by construction** (no more hand-written flags/stdout parsing) — streaming, tool permissions, and auth state come from the protocol. Launch per provider (`providers.ts` `acpLaunch()`): Claude → `npx -y @zed-industries/claude-code-acp` (Claude Code has no native ACP; Zed's adapter wraps it, uses the Claude plan), Gemini → `gemini --experimental-acp` (native), Codex → `codex acp` (best-effort — verify). The **ESM-only** ACP lib is bundled into the CJS main via `externalizeDepsPlugin({ exclude })` in `electron.vite.config.ts` (avoids `require(ESM)`). Capability layer / MCP server / UI / bots unchanged. **Residual (untested):** the exact launch commands (esp. Codex ACP + bundling claude-code-acp for a packaged release vs npx), and restricting the agent's _native_ tools (we auto-allow ACP `requestPermission`; our writes stay gated at the MCP layer).

## 11. Open decisions (resolve as we hit them)

1. **CLI session model:** one child per turn (simple, stateless) vs a persistent
   session per assistant thread (keeps context, more moving parts). → start per-turn.
2. **MCP execution route:** renderer-proxy (one code path, reactive) vs Convex-direct
   from main (needed for bots). → renderer-proxy for the agent MVP; Convex-direct when
   bots land.
3. **Assistant history store:** own Convex table vs `@convex-dev/agent`. → own table.
4. **Approval UX default:** confirm-writes vs confirm-everything. → confirm-writes.
5. **Distribution reality:** this hard-sells the **desktop** app (web can't do it).
   Reconcile with the web-first launch in `DEPLOY.md` — likely: launch web for the
   core, position the agent as "the reason to install the desktop app."
6. CLI flag drift → adapters probe `--version`; pin a "known-good" matrix in docs.

---

## 12. New modules (map)

```
convex/
  capabilities/            # Phase 0 — the tool catalog (principal-aware, gated)
    index.ts               #   registry + shared principal/permission helpers
    read.ts  write.ts
  bots.ts  (Phase 6)       # botUsers/botTokens/scopes + event fan-out hooks
src/main/agent/
  index.ts                 # registerAgentIpc(() => mainWindow) — Phase 1
  providers/{claude,codex,gemini}.ts   # ProviderAdapter impls
  mcp-server.ts            # loopback MCP server → capabilities
  session.ts               # spawn/stream/cancel lifecycle
src/preload/                # add `agent` to the bridge + types
src/renderer/src/
  lib/platform.ts          # platform.agent.* (desktop-gated, web no-ops)
  lib/capabilities-local.ts# Phase 4 — offline backend for the catalog
  components/agent/        # Assistant panel + AI-Elements-style components
  store/agent-store.ts     # transcript/turn/approval UI state
```

## 13. Dependencies to add (when building, per the pnpm/EPERM rule)

- `@modelcontextprotocol/sdk` (main — MCP server)
- Vercel **AI Elements** (copy-in components; adapt to Base UI) — presentational only
- `@convex-dev/rag` (optional, Phase 1+ — semantic `search_messages`)
- _No_ `node-pty` unless we add an interactive terminal view. _No_ `@ai-sdk/*` model
  packages (the CLI owns the model call). `@convex-dev/agent` intentionally skipped.

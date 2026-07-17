<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Start here

Read **`CLAUDE.md`** — it is the single source of truth for this repo: architecture, stack, conventions, and the **Engineering rules** section (TypeScript · Convex queries · error handling · CSS · UI).

**pnpm, not npm.** After every change run `pnpm typecheck && pnpm lint`; both must pass. Don't commit unless explicitly asked.

## The ripple rule — update every place a feature is used

**A feature is never edited in isolation.** When you add, change, or extend anything, find every place it is used or depended on and update those in the SAME change. In this repo that specifically means:

- **The dev platform is ONE capability catalog, three surfaces.** A capability change must update `convex/apiTools.ts` + the `TOOLS`/`callTool` dispatch in `convex/lib/mcp.ts` + the `/docs` table — so it lands in **MCP, the REST API, and bots** together, never one only.
- **Bots are real user principals** — anything on the message/notification/permission/avatar path must still work when the actor is a bot.
- **Offline/local parity is mandatory** — a feature that can run without a server must also exist in **local mode** (`/local`); a new local channel kind or data shape must be taught to `src/main/local-data.ts`, `src/renderer/src/lib/local-data.ts`, the local store, and the export/import format.
- **Enumerations leak** — every place that lists channels/threads/members/unread/notifications/search must learn about a new channel kind, permission, DM, or shared channel.
- **Shared UI + serializers** (composer, markdown, mentions, `DateTimePicker`, skeletons) have many call sites — change the contract in one, audit the rest.

After a change, grep for "what reads this table / calls this function / renders this shape / consumes this capability?" and update each dependent — or state explicitly what was left stale. Full detail lives in **`CLAUDE.md` → Engineering rules → The ripple rule**.

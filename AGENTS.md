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

import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Check, Copy, Plugs, Robot, ShieldCheck, Terminal } from '@phosphor-icons/react'
import { Logo } from '@renderer/components/layout/logo'
import { copyToClipboard } from '@renderer/lib/clipboard'
import { cn } from '@renderer/lib/utils'

export const Route = createFileRoute('/docs')({
  component: DocsPage
})

/** The public deployment's `.site` origin. Empty on a no-backend build; the docs still read. */
const SITE = (
  import.meta.env.VITE_CONVEX_SITE_URL ?? 'https://<your-deployment>.convex.site'
).replace(/\/$/, '')
const MCP_URL = SITE + '/mcp'

/** The capability catalog — the SAME set the MCP connector, the REST API and bots all expose.
 *  Kept in sync with `convex/lib/mcp.ts` (`TOOLS`) + `convex/apiTools.ts` by hand: when you add
 *  a capability there, add a row here. A mismatch is a docs bug, not a runtime one. */
const TOOLS = [
  // Reads
  {
    name: 'list_workspaces',
    args: '—',
    kind: 'read',
    desc: 'The workspaces you belong to. Call this first: every other capability needs a workspace slug.'
  },
  {
    name: 'list_channels',
    args: 'workspace',
    kind: 'read',
    desc: 'The channels you can see, each with its kind (chat / voice / page / kanban / whiteboard) and whether you can post.'
  },
  {
    name: 'list_members',
    args: 'workspace',
    kind: 'read',
    desc: 'The people and bots in a workspace, each with their role and id.'
  },
  {
    name: 'list_messages',
    args: 'workspace, channel, limit?',
    kind: 'read',
    desc: 'The most recent messages in a channel (oldest first), each with its id for edit / delete / react.'
  },
  {
    name: 'search_messages',
    args: 'workspace, query',
    kind: 'read',
    desc: 'Full-text search across every message you can read — your channels and your own DMs. Others’ DMs and private channels are never returned.'
  },
  {
    name: 'list_unread',
    args: 'workspace',
    kind: 'read',
    desc: 'The channels and DMs with unread activity, and how many messages mention you.'
  },
  {
    name: 'list_events',
    args: 'workspace, limit?',
    kind: 'read',
    desc: 'Upcoming calendar events, each with its id and times.'
  },
  {
    name: 'get_board',
    args: 'workspace, channel',
    kind: 'read',
    desc: 'A kanban board’s columns (in order) and tasks, with column + task ids for create_task / move_task.'
  },
  {
    name: 'get_page',
    args: 'workspace, channel',
    kind: 'read',
    desc: 'A page channel’s title and its text content (plain text).'
  },
  {
    name: 'get_voice',
    args: 'workspace, channel',
    kind: 'read',
    desc: 'Who’s currently in a voice channel’s call, with mic / camera / screen-share state.'
  },
  {
    name: 'get_whiteboard',
    args: 'workspace, channel',
    kind: 'read',
    desc: 'A whiteboard channel’s scene (Excalidraw element JSON + shape count). Read-only — drawn in the app.'
  },
  // Messages
  {
    name: 'post_message',
    args: 'workspace, channel, body',
    kind: 'write',
    desc: 'Post a message to a channel, as you. Refused in a channel you can’t post in. Markdown allowed.'
  },
  {
    name: 'edit_message',
    args: 'message, body',
    kind: 'write',
    desc: 'Edit a message you posted (id from list_messages / search_messages).'
  },
  {
    name: 'delete_message',
    args: 'message',
    kind: 'write',
    desc: 'Delete a message you posted (or any, if you’re an owner/admin).'
  },
  {
    name: 'react_message',
    args: 'message, emoji',
    kind: 'write',
    desc: 'Toggle an emoji reaction on a message, as you.'
  },
  {
    name: 'mark_read',
    args: 'workspace, channel',
    kind: 'write',
    desc: 'Clear a channel’s unread badge for you.'
  },
  // Channels
  {
    name: 'create_channel',
    args: 'workspace, name, kind, private?',
    kind: 'write',
    desc: 'Create a channel (chat / voice / page / kanban / whiteboard), optionally private.'
  },
  // Events
  {
    name: 'create_event',
    args: 'workspace, title, start, …',
    kind: 'write',
    desc: 'Create a calendar event, as you. Times are ISO 8601, read in the workspace’s time zone.'
  },
  {
    name: 'update_event',
    args: 'event, …',
    kind: 'write',
    desc: 'Change a calendar event. Organiser only.'
  },
  {
    name: 'delete_event',
    args: 'event',
    kind: 'write',
    desc: 'Delete a calendar event. Organiser only.'
  },
  {
    name: 'rsvp_event',
    args: 'event, status',
    kind: 'write',
    desc: 'Set your RSVP (going / maybe / declined / invited).'
  },
  // Kanban (tickets)
  {
    name: 'create_task',
    args: 'workspace, channel, column, title, …',
    kind: 'write',
    desc: 'Create a task (ticket) in a board column (by title or id).'
  },
  { name: 'update_task', args: 'task, …', kind: 'write', desc: 'Change a task’s fields.' },
  {
    name: 'move_task',
    args: 'task, column, position?',
    kind: 'write',
    desc: 'Move a task to another column (and optional position).'
  },
  { name: 'delete_task', args: 'task', kind: 'write', desc: 'Delete a task.' },
  {
    name: 'create_column',
    args: 'workspace, channel, title',
    kind: 'write',
    desc: 'Add a column to a board.'
  },
  { name: 'rename_column', args: 'column, title', kind: 'write', desc: 'Rename a board column.' },
  {
    name: 'delete_column',
    args: 'column',
    kind: 'write',
    desc: 'Delete a board column and its tasks.'
  },
  // Pages
  {
    name: 'set_page',
    args: 'workspace, channel, title?, text?',
    kind: 'write',
    desc: 'Set a page channel’s title and/or text (plain text; rich editing is in the app).'
  }
] as const

/** The `.convex.site` origin's REST base — the same deployment as the MCP endpoint. */
const API_BASE = SITE + '/api/v1'

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'connect', label: 'Connect an AI' },
  { id: 'claude', label: '— Claude' },
  { id: 'chatgpt', label: '— ChatGPT' },
  { id: 'inspector', label: '— MCP Inspector' },
  { id: 'auth', label: 'Authentication' },
  { id: 'api', label: 'REST API' },
  { id: 'tools', label: 'Capabilities' },
  { id: 'security', label: 'Security' },
  { id: 'bots', label: 'Bots' },
  { id: 'roadmap', label: 'Roadmap' }
]

function DocsPage(): React.JSX.Element {
  return (
    <div className="h-full overflow-y-auto bg-background">
      {/* Header */}
      <header className="border-b bg-card/50">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <Logo className="size-9 rounded-xl" />
          <div>
            <p className="text-sm font-bold">Zinx Threads</p>
            <p className="text-xs text-muted-foreground">Developer documentation</p>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-5xl gap-10 px-6 py-10">
        {/* Sticky TOC */}
        <nav className="sticky top-10 hidden h-fit w-48 shrink-0 space-y-1 lg:block">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={cn(
                'block rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground',
                section.label.startsWith('—') && 'pl-4 text-xs'
              )}
            >
              {section.label.replace('— ', '')}
            </a>
          ))}
        </nav>

        <main className="min-w-0 flex-1 space-y-12">
          {/* Overview */}
          <Section id="overview" icon={<Plugs />} title="Connect AI to Zinx Threads">
            <p>
              Zinx Threads speaks the{' '}
              <A href="https://modelcontextprotocol.io">Model Context Protocol (MCP)</A> — the open
              standard both <strong>Claude</strong> and <strong>ChatGPT</strong> use to connect to
              external tools. Point any MCP-capable AI at one URL, sign in once, and it can read
              your channels, search your messages and tell you what you missed —{' '}
              <strong>acting as you</strong>, with exactly your permissions and nothing more.
            </p>
            <p>
              This is a <strong>remote MCP server</strong> over Streamable HTTP. There is nothing to
              install or host — the endpoint is:
            </p>
            <CopyBlock value={MCP_URL} />
            <Callout>
              The connector <strong>acts as you</strong> and has the <strong>full API</strong>: it
              can read your channels, post / edit / delete messages, react, manage events, and
              create channels, pages and kanban tasks — anything you can do in the app, in the
              places you’re allowed to. It can never do anything you couldn’t. Prefer plain HTTP?
              The same capabilities are a{' '}
              <a href="#api" className="underline">
                REST API
              </a>
              .
            </Callout>
          </Section>

          {/* Connect */}
          <Section id="connect" icon={<Robot />} title="Connect an AI">
            <p>
              Claude and ChatGPT connect with <strong>just the URL</strong> — you sign in and
              approve, no token to paste. Follow the steps for your AI below. (For the MCP Inspector
              or scripts, create a token under <strong>Settings → Developers</strong> instead — see{' '}
              <a href="#auth" className="underline">
                Authentication
              </a>
              .)
            </p>
          </Section>

          <SubSection id="claude" title="Claude">
            <ol>
              <li>
                In Claude, open <strong>Settings → Connectors</strong> and click{' '}
                <strong>Add custom connector</strong>.
              </li>
              <li>
                Give it a name (e.g. <em>Zinx Threads</em>) and paste the{' '}
                <strong>Remote MCP server URL</strong> above. Leave the OAuth fields under{' '}
                <strong>Advanced settings</strong> empty — Claude registers itself automatically.
              </li>
              <li>
                Click <strong>Add</strong>, then <strong>Connect</strong>. Claude sends you to a{' '}
                <strong>Zinx Threads sign-in</strong> and asks you to approve access — this is the
                standard OAuth flow, so no token to paste.
              </li>
              <li>
                Ask Claude something like <em>“What did I miss in my Zinx workspace today?”</em>.
              </li>
            </ol>
            <Callout>
              The connector signs in as <strong>you</strong>, through Zinx Threads’ own login. It
              can only ever see what you can — approving it doesn’t grant Claude anything beyond
              your own access.
            </Callout>
          </SubSection>

          <SubSection id="chatgpt" title="ChatGPT">
            <ol>
              <li>
                Enable <strong>Developer Mode</strong> (Settings → Connectors → Advanced) on a plan
                that supports custom connectors.
              </li>
              <li>
                Add a connector with the MCP server URL above. As with Claude, you’ll be sent
                through a Zinx Threads sign-in and consent — OAuth, no pasted token.
              </li>
              <li>
                In a chat, open the connector and ask it to search or summarise your workspace.
              </li>
            </ol>
          </SubSection>

          <SubSection id="inspector" title="MCP Inspector (any client)">
            <p>
              The quickest way to try the tools — the official inspector talks to any MCP server:
            </p>
            <CodeBlock>{`npx @modelcontextprotocol/inspector`}</CodeBlock>
            <p>
              Set <strong>Transport</strong> to <em>Streamable HTTP</em>, the <strong>URL</strong>{' '}
              to the endpoint above, add an <code>Authorization: Bearer &lt;your-token&gt;</code>{' '}
              header, and connect. You’ll see <code>list_workspaces</code>,{' '}
              <code>list_channels</code>, <code>search_messages</code> and <code>list_unread</code>{' '}
              ready to call.
            </p>
            <p className="text-sm text-muted-foreground">Or with plain curl:</p>
            <CodeBlock>{`curl -X POST ${MCP_URL} \\
  -H "Authorization: Bearer $ZINX_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"list_workspaces","arguments":{}}}'`}</CodeBlock>
          </SubSection>

          {/* Auth */}
          <Section id="auth" icon={<Terminal />} title="Authentication">
            <p>There are two ways to authenticate, and both act as one user:</p>
            <ul>
              <li>
                <strong>OAuth 2.1 (recommended).</strong> Claude, ChatGPT and any spec-compliant MCP
                client discover our authorization server, register themselves, and send you through
                a Zinx Threads sign-in — no token to paste. This is the flow in the connection steps
                above.
              </li>
              <li>
                <strong>Personal access token.</strong> For the MCP Inspector, scripts, or any
                client that takes a bearer credential:
              </li>
            </ul>
            <CodeBlock>{`Authorization: Bearer zt_xxxxxxxx…`}</CodeBlock>
            <ul>
              <li>
                Create and revoke tokens under <strong>Settings → Developers</strong>. A token is
                shown <strong>once</strong>; we store only a hash, so it can’t be recovered — lose
                it and you make a new one.
              </li>
              <li>
                Either credential <strong>acts as you</strong> — it inherits your workspaces, your
                channel membership and your permissions, and can never see more than you can.
              </li>
              <li>Revoking a token, or removing the connector, cuts off access immediately.</li>
            </ul>
          </Section>

          {/* REST API */}
          <Section id="api" icon={<Terminal />} title="REST API">
            <p>
              Not everything is an AI. For scripts, CI, backends and one-off automations, the exact
              same capabilities are a plain <strong>JSON-over-HTTP</strong> API — same auth, same
              permission checks. (The MCP connector and this API share one implementation, so they
              can never drift.) The base URL is:
            </p>
            <CopyBlock value={API_BASE} />
            <p>
              Authenticate with a <strong>bearer token</strong> — a personal access token from{' '}
              <strong>Settings → Developers</strong>, or a <strong>bot token</strong>. Every request
              acts as that user (or bot) and can do only what they can.
            </p>
            <SubSection id="api-endpoints" title="Endpoints">
              <ul>
                <li>
                  <code>GET {API_BASE}</code> — a public liveness/info document (no auth).
                </li>
                <li>
                  <code>GET {API_BASE}/tools</code> — the capability catalog (every name + its JSON
                  Schema). Authenticated.
                </li>
                <li>
                  <code>POST {API_BASE}/tools/&lt;name&gt;</code> — run a capability. The request
                  body is a JSON object of its arguments (see{' '}
                  <a href="#tools" className="underline">
                    Capabilities
                  </a>
                  ). Returns <code>{'{ "ok": true, "result": … }'}</code>, or{' '}
                  <code>{'{ "ok": false, "error": "…" }'}</code> with a <code>400</code> on a
                  permission / validation error.
                </li>
              </ul>
            </SubSection>
            <SubSection id="api-examples" title="Examples">
              <p className="text-sm text-muted-foreground">Post a message:</p>
              <CodeBlock>{`curl -X POST "${API_BASE}/tools/post_message" \\
  -H "Authorization: Bearer $ZINX_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"workspace":"acme","channel":"general","body":"Deploy #42 is live 🚀"}'`}</CodeBlock>
              <p className="text-sm text-muted-foreground">
                Create a kanban task (a “ticket”). Get the board’s column titles first with{' '}
                <code>get_board</code>:
              </p>
              <CodeBlock>{`curl -X POST "${API_BASE}/tools/create_task" \\
  -H "Authorization: Bearer $ZINX_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"workspace":"acme","channel":"roadmap","column":"To Do",
       "title":"Investigate the flaky test","priority":"high"}'`}</CodeBlock>
            </SubSection>
          </Section>

          {/* Tools */}
          <Section id="tools" icon={<Plugs />} title="Capabilities">
            <p>
              One catalog powers all three surfaces — the <strong>MCP connector</strong>, the{' '}
              <strong>REST API</strong> (<code>POST /api/v1/tools/&lt;name&gt;</code>) and{' '}
              <strong>bots</strong>. Every capability takes JSON arguments and returns JSON. An{' '}
              argument ending in <code>?</code> is optional. Ids (a message, task, event or column)
              come from the matching <code>list_</code> / <code>get_</code> read.
            </p>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Tool</th>
                    <th className="px-3 py-2 font-medium"></th>
                    <th className="px-3 py-2 font-medium">Arguments</th>
                    <th className="px-3 py-2 font-medium">Returns</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {TOOLS.map((tool) => (
                    <tr key={tool.name} className="align-top">
                      <td className="px-3 py-2.5 font-mono text-xs font-medium">{tool.name}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                            tool.kind === 'write'
                              ? 'bg-warning/15 text-warning'
                              : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {tool.kind}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                        {tool.args}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{tool.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground">
              A <code>workspace</code> argument is a workspace <em>slug</em> — the readable id from{' '}
              <code>list_workspaces</code>, e.g. <code>acme</code>.
            </p>
          </Section>

          {/* Security */}
          <Section id="security" icon={<ShieldCheck />} title="Security &amp; permissions">
            <ul>
              <li>
                <strong>Acts as you, never more.</strong> Every tool routes through the same access
                checks the app itself uses. A private channel you can’t open is invisible to your
                AI; a read-only channel reports that it’s read-only.
              </li>
              <li>
                <strong>Your DMs stay yours.</strong> Search returns your own DMs, never anyone
                else’s — the same rule as in the app.
              </li>
              <li>
                <strong>Tokens are hashed at rest.</strong> A leaked database never yields a working
                credential.
              </li>
              <li>
                <strong>Scoped to your account.</strong> A token can reach every workspace you’re a
                member of. Per-workspace and per-scope tokens are on the roadmap.
              </li>
            </ul>
          </Section>

          {/* Bots */}
          <Section id="bots" icon={<Robot />} title="Bots">
            <p>
              A <strong>bot</strong> is an automation that posts as a member of a workspace. Create
              one in <strong>Workspace settings → Bots</strong> (owner/admin). A bot gets a token
              and can have <strong>incoming webhooks</strong>. It can only reach channels it can
              post in — the same permission rules as a person.
            </p>
            <SubSection id="bots-api" title="Driving a bot with its token">
              <p>
                A bot’s token is a bearer credential for both the MCP endpoint and the{' '}
                <a href="#api" className="underline">
                  REST API
                </a>{' '}
                — the bot acts as itself. Every{' '}
                <a href="#tools" className="underline">
                  capability
                </a>{' '}
                works, scoped to the bot’s workspace and its channel access. So a bot can post,
                react, create tasks, manage events — the same full API a person has.
              </p>
            </SubSection>
            <SubSection id="bots-webhooks" title="Incoming webhooks">
              <p>
                The simplest integration — no code, just an HTTP POST. Create a webhook on a bot
                (pick a channel), then have your service (CI, alerts, GitHub…) POST to the URL:
              </p>
              <CodeBlock>{`curl -X POST "${SITE}/hooks/zt_your_webhook_secret" \\
  -H "Content-Type: application/json" \\
  -d '{"text":"✅ Deploy to production succeeded — v1.2.3"}'`}</CodeBlock>
              <p>
                The message posts into the webhook’s channel as the bot. A plain{' '}
                <code>-d &quot;text=…&quot;</code> form body works too. The URL <em>is</em> the
                credential — keep it secret; delete it in settings to revoke it instantly.
              </p>
            </SubSection>
          </Section>

          {/* Roadmap */}
          <Section id="roadmap" icon={<Robot />} title="Roadmap">
            <ul>
              <li>
                <Badge>Done</Badge> <strong>OAuth 2.1</strong> — connect in Claude and ChatGPT with
                just the URL, via a Zinx Threads sign-in.
              </li>
              <li>
                <Badge>Done</Badge> <strong>Full CRUD</strong> — post / edit / delete / react to
                messages, create channels, manage events (create / update / delete / RSVP), kanban
                tasks &amp; columns, and pages — all gated by your permissions.
              </li>
              <li>
                <Badge>Done</Badge> <strong>REST API</strong> — the same capabilities as plain
                JSON-over-HTTP (<code>POST /api/v1/tools/&lt;name&gt;</code>) for scripts and CI.
              </li>
              <li>
                <Badge>Done</Badge> <strong>Bots &amp; incoming webhooks</strong> — automation
                members that post as a bot, with Slack-style webhook URLs.
              </li>
              <li>
                <Badge>Next</Badge> <strong>Threads &amp; DMs</strong> — start a thread, reply in
                one, and send a direct message from the API.
              </li>
              <li>
                <Badge>Later</Badge> <strong>Slash commands &amp; events</strong> — a bot that
                responds to `/commands` and subscribes to workspace events (HTTP interactions).
              </li>
              <li>
                <Badge>Later</Badge> <strong>Scoped tokens</strong> — per-workspace, read-only vs
                read-write.
              </li>
            </ul>
          </Section>

          <footer className="border-t pt-6 text-sm text-muted-foreground">
            Building something? The MCP connector, the REST API and bots all share one capability
            catalog, so this page stays in step with what the app can do.
          </footer>
        </main>
      </div>
    </div>
  )
}

function Section({
  id,
  icon,
  title,
  children
}: {
  id: string
  icon: React.ReactNode
  title: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <span className="text-primary [&>svg]:size-5">{icon}</span>
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-foreground [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_ol]:space-y-1.5 [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  )
}

function SubSection({
  id,
  title,
  children
}: {
  id: string
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="space-y-3 text-sm leading-relaxed text-foreground [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_ol]:space-y-1.5 [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  )
}

function A({ href, children }: { href: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-primary hover:underline"
    >
      {children}
    </a>
  )
}

function Callout({
  children,
  tone = 'info'
}: {
  children: React.ReactNode
  tone?: 'info' | 'warning'
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'rounded-lg border px-3.5 py-2.5 text-sm',
        tone === 'warning'
          ? 'border-warning/30 bg-warning/5 text-foreground'
          : 'border-primary/30 bg-primary/5 text-foreground'
      )}
    >
      {children}
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="mr-1 inline-block rounded bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary">
      {children}
    </span>
  )
}

function CodeBlock({ children }: { children: string }): React.JSX.Element {
  return (
    <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
      <code>{children}</code>
    </pre>
  )
}

function CopyBlock({ value }: { value: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    if (await copyToClipboard(value)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs">
        {value}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-accent"
      >
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

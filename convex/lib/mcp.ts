import { ConvexError } from 'convex/values'
import { internal } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { BRAND } from './brand'

/**
 * The MCP (Model Context Protocol) server logic — the protocol both Claude and ChatGPT speak to
 * a "custom connector". This file is pure protocol + tool dispatch; the HTTP transport (auth,
 * CORS, framing) is `convex/http.ts`, the identity/token layer is `convex/mcp.ts`, and the
 * capabilities each tool runs are `convex/apiTools.ts`.
 *
 * `TOOLS` + `callTool` are the SINGLE catalog shared by every developer surface: the MCP
 * connector, the REST API (`POST /api/v1/tools/<name>`) and bots all go through `callTool`. Add
 * a tool here and to `apiTools.ts` and it lands in all three at once.
 */

export const MCP_SERVER_INFO = { name: BRAND.productName, version: '0.1.0' }

/** The protocol revision we implement. We echo the client's requested version when it sends one
 *  it likes; this is the fallback. */
export const PROTOCOL_VERSION = '2025-06-18'

const PRIORITY = ['lowest', 'low', 'medium', 'high', 'highest']
const RSVP = ['going', 'maybe', 'declined', 'invited']
const CHANNEL_KIND = ['chat', 'voice', 'page', 'kanban', 'whiteboard', 'database', 'form']

/** The tools. Each `inputSchema` is JSON Schema — the exact contract a client fills in.
 *  `annotations` are MCP hints (`readOnlyHint: false` → the client defaults it to needing
 *  approval; `destructiveHint` flags the irreversible ones). Reads come first. Every write acts
 *  AS the user and is gated server-side, so a token can only ever do what its owner can. */
export const TOOLS = [
  // --- Reads ---------------------------------------------------------------
  {
    name: 'list_workspaces',
    description:
      'List the Zinx Threads workspaces the user belongs to. Call this first — every other tool needs a workspace slug, which this returns.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'list_channels',
    description:
      'List the channels the user can see in a workspace, each with its kind (chat / voice / page / kanban / whiteboard / database / form), visibility, and whether the user can post. Only channels the user has access to are returned.',
    inputSchema: {
      type: 'object',
      properties: { workspace: { type: 'string', description: 'The workspace slug.' } },
      required: ['workspace'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'list_members',
    description: 'List the people and bots in a workspace, each with their role and id.',
    inputSchema: {
      type: 'object',
      properties: { workspace: { type: 'string', description: 'The workspace slug.' } },
      required: ['workspace'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'list_messages',
    description:
      'List the most recent messages in a channel (oldest first), each with its id — pass that id to edit_message / delete_message / react_message.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        channel: { type: 'string', description: 'The channel name, e.g. "general".' },
        limit: { type: 'number', description: 'How many (1–50, default 20).' }
      },
      required: ['workspace', 'channel'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'search_messages',
    description:
      'Full-text search across every message the user can read in a workspace — channels they are in and their own DMs. Returns the message id, channel, author, text and timestamp. Private channels and other people’s DMs are never returned.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        query: { type: 'string', description: 'The text to search for.' }
      },
      required: ['workspace', 'query'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'list_unread',
    description:
      'List the channels and DMs that have unread activity for the user in a workspace, with how many messages mention them. Answers "what did I miss?".',
    inputSchema: {
      type: 'object',
      properties: { workspace: { type: 'string', description: 'The workspace slug.' } },
      required: ['workspace'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'list_events',
    description: 'List upcoming calendar events in a workspace, each with its id and times.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        limit: { type: 'number', description: 'How many (1–100, default 20).' }
      },
      required: ['workspace'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'get_board',
    description:
      'Get a kanban board channel’s columns (in order) and their tasks, with column and task ids to pass to create_task / move_task / update_task.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        channel: { type: 'string', description: 'The board channel name.' }
      },
      required: ['workspace', 'channel'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'get_page',
    description: 'Get a page channel’s title and its text content (plain text).',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        channel: { type: 'string', description: 'The page channel name.' }
      },
      required: ['workspace', 'channel'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'get_voice',
    description:
      'List who is currently in a voice channel’s call, with each person’s mic / camera / screen-share / deafen state.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        channel: { type: 'string', description: 'The voice channel name.' }
      },
      required: ['workspace', 'channel'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'get_whiteboard',
    description:
      'Get a whiteboard channel’s scene — the Excalidraw element JSON and shape count. Whiteboards are drawn in the app, so this is read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        channel: { type: 'string', description: 'The whiteboard channel name.' }
      },
      required: ['workspace', 'channel'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'get_database',
    description:
      'Get a database channel’s fields (each with its id and type) and its records (each with its id and values keyed by field id). Pass those ids to create_record / update_record / delete_record.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        channel: { type: 'string', description: 'The database channel name.' }
      },
      required: ['workspace', 'channel'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'get_form',
    description:
      'Get a form channel’s schema — its title, description, fields (each with its id, name, type and whether it’s required) and how many responses it has.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        channel: { type: 'string', description: 'The form channel name.' }
      },
      required: ['workspace', 'channel'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'list_responses',
    description:
      'List a form channel’s submissions — each with its id, timestamp and answer values keyed by field id.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        channel: { type: 'string', description: 'The form channel name.' }
      },
      required: ['workspace', 'channel'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  // --- Messages ------------------------------------------------------------
  {
    name: 'post_message',
    description:
      'Post a message to a channel, as the user. Only works in channels the user can post in. The body supports Markdown.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        channel: { type: 'string', description: 'The channel name.' },
        body: { type: 'string', description: 'The message text (Markdown allowed).' }
      },
      required: ['workspace', 'channel', 'body'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'edit_message',
    description:
      'Edit a message the user posted. Provide its id (from list_messages / search_messages).',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message id.' },
        body: { type: 'string', description: 'The new text.' }
      },
      required: ['message', 'body'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'delete_message',
    description:
      'Delete a message the user posted (or any, if the user is an owner/admin). Irreversible.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'The message id.' } },
      required: ['message'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true }
  },
  {
    name: 'react_message',
    description: 'Toggle an emoji reaction on a message, as the user.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message id.' },
        emoji: { type: 'string', description: 'The emoji, e.g. "👍".' }
      },
      required: ['message', 'emoji'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'mark_read',
    description: 'Mark a channel as read for the user, clearing its unread badge.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        channel: { type: 'string', description: 'The channel name.' }
      },
      required: ['workspace', 'channel'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
  },
  // --- Channels ------------------------------------------------------------
  {
    name: 'create_channel',
    description:
      'Create a channel in a workspace, as the user. kind is one of chat, voice, page, kanban, whiteboard, database, form.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        name: { type: 'string', description: 'The channel name.' },
        kind: { type: 'string', enum: CHANNEL_KIND, description: 'The channel kind.' },
        private: { type: 'boolean', description: 'Make it private (members-only). Default false.' }
      },
      required: ['workspace', 'name', 'kind'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  // --- Events --------------------------------------------------------------
  {
    name: 'create_event',
    description:
      'Create a calendar event in a workspace, as the user. Times are ISO 8601 (e.g. "2026-07-20T09:00:00"), interpreted in the workspace’s time zone.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        title: { type: 'string' },
        start: { type: 'string', description: 'ISO 8601 start date-time.' },
        end: { type: 'string', description: 'ISO 8601 end (defaults to 1 hour after start).' },
        description: { type: 'string' },
        location: { type: 'string' },
        allDay: { type: 'boolean' },
        channel: { type: 'string', description: 'Optional public channel to attach it to.' }
      },
      required: ['workspace', 'title', 'start'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'update_event',
    description: 'Change a calendar event. Organiser only. Only the fields you pass change.',
    inputSchema: {
      type: 'object',
      properties: {
        event: { type: 'string', description: 'The event id (from list_events).' },
        title: { type: 'string' },
        description: { type: 'string' },
        location: { type: 'string' },
        start: { type: 'string', description: 'ISO 8601 start.' },
        end: { type: 'string', description: 'ISO 8601 end.' },
        allDay: { type: 'boolean' }
      },
      required: ['event'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'delete_event',
    description: 'Delete a calendar event. Organiser only. Irreversible.',
    inputSchema: {
      type: 'object',
      properties: { event: { type: 'string', description: 'The event id.' } },
      required: ['event'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true }
  },
  {
    name: 'rsvp_event',
    description: 'Set the user’s RSVP to an event.',
    inputSchema: {
      type: 'object',
      properties: {
        event: { type: 'string', description: 'The event id.' },
        status: { type: 'string', enum: RSVP, description: 'Your response.' }
      },
      required: ['event', 'status'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
  },
  // --- Kanban (tickets) ----------------------------------------------------
  {
    name: 'create_task',
    description:
      'Create a task (ticket) in a board column, as the user. Identify the column by its title or id (from get_board).',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        channel: { type: 'string', description: 'The board channel name.' },
        column: { type: 'string', description: 'The column title or id.' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: PRIORITY, description: 'Default medium.' },
        dueDate: { type: 'string', description: 'ISO date, YYYY-MM-DD.' },
        labels: { type: 'array', items: { type: 'string' } }
      },
      required: ['workspace', 'channel', 'column', 'title'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'update_task',
    description: 'Change a task’s fields. Only the fields you pass change.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task id (from get_board).' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: PRIORITY },
        dueDate: { type: 'string', description: 'ISO date, or empty to clear.' },
        labels: { type: 'array', items: { type: 'string' } }
      },
      required: ['task'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'move_task',
    description: 'Move a task to another column (and optional position), as the user.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task id.' },
        column: { type: 'string', description: 'The target column title or id.' },
        position: {
          type: 'number',
          description: 'Zero-based position in the column (default: end).'
        }
      },
      required: ['task', 'column'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'delete_task',
    description: 'Delete a task. Irreversible.',
    inputSchema: {
      type: 'object',
      properties: { task: { type: 'string', description: 'The task id.' } },
      required: ['task'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true }
  },
  {
    name: 'create_column',
    description: 'Add a column to a board, as the user.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        channel: { type: 'string', description: 'The board channel name.' },
        title: { type: 'string' }
      },
      required: ['workspace', 'channel', 'title'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'rename_column',
    description: 'Rename a board column.',
    inputSchema: {
      type: 'object',
      properties: {
        column: { type: 'string', description: 'The column id (from get_board).' },
        title: { type: 'string' }
      },
      required: ['column', 'title'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'delete_column',
    description: 'Delete a board column AND its tasks. Irreversible.',
    inputSchema: {
      type: 'object',
      properties: { column: { type: 'string', description: 'The column id.' } },
      required: ['column'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true }
  },
  // --- Pages ---------------------------------------------------------------
  {
    name: 'set_page',
    description:
      'Set a page channel’s title and/or text (plain text). Rich formatting is edited in the app.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        channel: { type: 'string', description: 'The page channel name.' },
        title: { type: 'string' },
        text: { type: 'string', description: 'Plain text; each line becomes a paragraph.' }
      },
      required: ['workspace', 'channel'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  // --- Database (records) --------------------------------------------------
  {
    name: 'create_record',
    description:
      'Add a record (row) to a database channel, as the user. `values` is an object keyed by field id (from get_database), e.g. {"<fieldId>": "Acme"}.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace slug.' },
        channel: { type: 'string', description: 'The database channel name.' },
        values: {
          type: 'object',
          description: 'Cell values keyed by field id.',
          additionalProperties: true
        }
      },
      required: ['workspace', 'channel'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'update_record',
    description:
      'Update a database record’s cells. Provide its id (from get_database) and `values` keyed by field id — only those cells change; a null or empty value clears a cell.',
    inputSchema: {
      type: 'object',
      properties: {
        record: { type: 'string', description: 'The record id.' },
        values: {
          type: 'object',
          description: 'Cell values keyed by field id.',
          additionalProperties: true
        }
      },
      required: ['record', 'values'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'delete_record',
    description: 'Delete a database record. Irreversible.',
    inputSchema: {
      type: 'object',
      properties: { record: { type: 'string', description: 'The record id.' } },
      required: ['record'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true }
  }
] as const

/** The names of every tool that mutates state — i.e. NOT `readOnlyHint`. Derived from the
 *  catalog itself, so it can never drift from `TOOLS`. Used to gate the API-write rate limit. */
const WRITE_TOOLS = new Set<string>(
  TOOLS.filter(
    (tool) => !('readOnlyHint' in tool.annotations && tool.annotations.readOnlyHint)
  ).map((tool) => tool.name)
)

type JsonRpcId = string | number | null
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: Record<string, unknown>
}
interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string }
}

const ok = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result })
const err = (id: JsonRpcId, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message }
})

/**
 * Handle one JSON-RPC message. Returns the response object, or **null** for a notification (a
 * message with no `id`, e.g. `notifications/initialized`) — the caller answers those with a bare
 * 202, since JSON-RPC forbids a response to a notification.
 */
export async function handleRpc(
  ctx: ActionCtx,
  userId: Id<'users'>,
  message: JsonRpcRequest
): Promise<JsonRpcResponse | null> {
  const { id = null, method, params = {} } = message
  const isNotification = message.id === undefined

  switch (method) {
    case 'initialize': {
      const requested = (params.protocolVersion as string) || PROTOCOL_VERSION
      return ok(id, {
        protocolVersion: requested,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO
      })
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, { tools: TOOLS })
    case 'tools/call': {
      const name = params.name as string
      const args = (params.arguments as Record<string, unknown>) ?? {}
      try {
        const result = await callTool(ctx, userId, name, args)
        return ok(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
      } catch (error) {
        // Tool errors are reported IN the result (`isError`), not as a protocol error, so the
        // model can read what went wrong and adapt — per the MCP spec. Only a ConvexError's
        // message (one we authored) is surfaced; an unexpected internal error stays generic so
        // it can't leak a stack to the model.
        const text =
          error instanceof ConvexError
            ? String(error.data)
            : error instanceof Error && error.message.startsWith('Unknown tool')
              ? error.message
              : 'The tool failed. Check the arguments and try again.'
        if (!(error instanceof ConvexError)) console.error('MCP tool error:', error)
        return ok(id, { content: [{ type: 'text', text }], isError: true })
      }
    }
    default:
      if (isNotification) return null
      return err(id, -32601, `Method not found: ${method}`)
  }
}

/**
 * Run one tool by name — the shared dispatch behind MCP, the REST API and bots. Throws a
 * `ConvexError` on a permission / not-found / validation failure (each transport turns that into
 * its own error shape). Adding a capability means one case here + one function in `apiTools.ts`.
 */
export async function callTool(
  ctx: ActionCtx,
  userId: Id<'users'>,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const workspace = str(args, 'workspace')
  // Every WRITE tool spends the shared per-actor `apiWrite` budget first (reads are free).
  // Gated by the tool's own `readOnlyHint`, so a newly-added write tool inherits the limit
  // with no extra wiring — the same "one catalog" discipline the rest of this file keeps.
  if (WRITE_TOOLS.has(name)) {
    await ctx.runMutation(internal.apiTools.spendWriteBudget, { userId })
  }
  switch (name) {
    // Reads
    case 'list_workspaces':
      return ctx.runQuery(internal.apiTools.workspacesFor, { userId })
    case 'list_channels':
      return ctx.runQuery(internal.apiTools.channelsFor, { userId, slug: workspace })
    case 'list_members':
      return ctx.runQuery(internal.apiTools.membersFor, { userId, slug: workspace })
    case 'list_messages':
      return ctx.runQuery(internal.apiTools.listMessagesFor, {
        userId,
        slug: workspace,
        channel: str(args, 'channel'),
        limit: optNum(args, 'limit')
      })
    case 'search_messages':
      return ctx.runQuery(internal.apiTools.searchFor, {
        userId,
        slug: workspace,
        term: str(args, 'query')
      })
    case 'list_unread':
      return ctx.runQuery(internal.apiTools.unreadFor, { userId, slug: workspace })
    case 'list_events':
      return ctx.runQuery(internal.apiTools.eventsFor, {
        userId,
        slug: workspace,
        limit: optNum(args, 'limit')
      })
    case 'get_board':
      return ctx.runQuery(internal.apiTools.boardFor, {
        userId,
        slug: workspace,
        channel: str(args, 'channel')
      })
    case 'get_page':
      return ctx.runQuery(internal.apiTools.pageFor, {
        userId,
        slug: workspace,
        channel: str(args, 'channel')
      })
    case 'get_voice':
      return ctx.runQuery(internal.apiTools.voiceFor, {
        userId,
        slug: workspace,
        channel: str(args, 'channel')
      })
    case 'get_whiteboard':
      return ctx.runQuery(internal.apiTools.whiteboardFor, {
        userId,
        slug: workspace,
        channel: str(args, 'channel')
      })
    case 'get_database':
      return ctx.runQuery(internal.apiTools.databaseFor, {
        userId,
        slug: workspace,
        channel: str(args, 'channel')
      })
    case 'get_form':
      return ctx.runQuery(internal.apiTools.formSchemaFor, {
        userId,
        slug: workspace,
        channel: str(args, 'channel')
      })
    case 'list_responses':
      return ctx.runQuery(internal.apiTools.formResponsesFor, {
        userId,
        slug: workspace,
        channel: str(args, 'channel')
      })
    // Messages
    case 'post_message':
      return ctx.runMutation(internal.apiTools.postMessageFor, {
        userId,
        slug: workspace,
        channel: str(args, 'channel'),
        body: str(args, 'body')
      })
    case 'edit_message':
      return ctx.runMutation(internal.apiTools.editMessageFor, {
        userId,
        message: str(args, 'message'),
        body: str(args, 'body')
      })
    case 'delete_message':
      return ctx.runMutation(internal.apiTools.deleteMessageFor, {
        userId,
        message: str(args, 'message')
      })
    case 'react_message':
      return ctx.runMutation(internal.apiTools.reactMessageFor, {
        userId,
        message: str(args, 'message'),
        emoji: str(args, 'emoji')
      })
    case 'mark_read':
      return ctx.runMutation(internal.apiTools.markReadFor, {
        userId,
        slug: workspace,
        channel: str(args, 'channel')
      })
    // Channels
    case 'create_channel':
      return ctx.runMutation(internal.apiTools.createChannelFor, {
        userId,
        slug: workspace,
        name: str(args, 'name'),
        kind: str(args, 'kind'),
        private: optBool(args, 'private')
      })
    // Events
    case 'create_event':
      return ctx.runMutation(internal.apiTools.createEventFor, {
        userId,
        slug: workspace,
        title: str(args, 'title'),
        start: str(args, 'start'),
        end: optStr(args, 'end'),
        description: optStr(args, 'description'),
        location: optStr(args, 'location'),
        allDay: optBool(args, 'allDay'),
        channel: optStr(args, 'channel')
      })
    case 'update_event':
      return ctx.runMutation(internal.apiTools.updateEventFor, {
        userId,
        event: str(args, 'event'),
        title: optStr(args, 'title'),
        description: optStr(args, 'description'),
        location: optStr(args, 'location'),
        start: optStr(args, 'start'),
        end: optStr(args, 'end'),
        allDay: optBool(args, 'allDay')
      })
    case 'delete_event':
      return ctx.runMutation(internal.apiTools.deleteEventFor, {
        userId,
        event: str(args, 'event')
      })
    case 'rsvp_event':
      return ctx.runMutation(internal.apiTools.rsvpEventFor, {
        userId,
        event: str(args, 'event'),
        status: rsvp(args)
      })
    // Kanban
    case 'create_task':
      return ctx.runMutation(internal.apiTools.createTaskFor, {
        userId,
        slug: workspace,
        channel: str(args, 'channel'),
        column: str(args, 'column'),
        title: str(args, 'title'),
        description: optStr(args, 'description'),
        priority: priority(args),
        dueDate: optStr(args, 'dueDate'),
        labels: optStrArray(args, 'labels')
      })
    case 'update_task':
      return ctx.runMutation(internal.apiTools.updateTaskFor, {
        userId,
        task: str(args, 'task'),
        title: optStr(args, 'title'),
        description: optStr(args, 'description'),
        priority: priority(args),
        dueDate: optStr(args, 'dueDate'),
        labels: optStrArray(args, 'labels')
      })
    case 'move_task':
      return ctx.runMutation(internal.apiTools.moveTaskFor, {
        userId,
        task: str(args, 'task'),
        column: str(args, 'column'),
        position: optNum(args, 'position')
      })
    case 'delete_task':
      return ctx.runMutation(internal.apiTools.deleteTaskFor, { userId, task: str(args, 'task') })
    case 'create_column':
      return ctx.runMutation(internal.apiTools.createColumnFor, {
        userId,
        slug: workspace,
        channel: str(args, 'channel'),
        title: str(args, 'title')
      })
    case 'rename_column':
      return ctx.runMutation(internal.apiTools.renameColumnFor, {
        userId,
        column: str(args, 'column'),
        title: str(args, 'title')
      })
    case 'delete_column':
      return ctx.runMutation(internal.apiTools.deleteColumnFor, {
        userId,
        column: str(args, 'column')
      })
    // Pages
    case 'set_page':
      return ctx.runMutation(internal.apiTools.setPageFor, {
        userId,
        slug: workspace,
        channel: str(args, 'channel'),
        title: optStr(args, 'title'),
        text: optStr(args, 'text')
      })
    // Database records
    case 'create_record':
      return ctx.runMutation(internal.apiTools.createRecordFor, {
        userId,
        slug: workspace,
        channel: str(args, 'channel'),
        values: cellValues(args)
      })
    case 'update_record':
      return ctx.runMutation(internal.apiTools.updateRecordFor, {
        userId,
        record: str(args, 'record'),
        values: cellValues(args) ?? {}
      })
    case 'delete_record':
      return ctx.runMutation(internal.apiTools.deleteRecordFor, {
        userId,
        record: str(args, 'record')
      })
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// --- Argument coercion (a tool call's `arguments` is untrusted JSON) --------------------------
function str(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === 'string' ? (args[key] as string) : ''
}
function optStr(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === 'string' ? (args[key] as string) : undefined
}
function optNum(args: Record<string, unknown>, key: string): number | undefined {
  return typeof args[key] === 'number' ? (args[key] as number) : undefined
}
function optBool(args: Record<string, unknown>, key: string): boolean | undefined {
  return typeof args[key] === 'boolean' ? (args[key] as boolean) : undefined
}
function optStrArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key]
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined
}
/** Coerce a tool's untrusted `values` object into the cell shapes the DB accepts
 *  (string / number / boolean / string[] / null) — dropping anything else, so a crafted
 *  payload can't smuggle an object or nested array into a record. */
function cellValues(
  args: Record<string, unknown>
): Record<string, string | number | boolean | string[] | null> | undefined {
  const raw = args.values
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const out: Record<string, string | number | boolean | string[] | null> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out[key] = value
    } else if (Array.isArray(value)) {
      out[key] = value.filter((v): v is string => typeof v === 'string')
    }
  }
  return out
}
function priority(
  args: Record<string, unknown>
): 'lowest' | 'low' | 'medium' | 'high' | 'highest' | undefined {
  const value = args.priority
  return typeof value === 'string' && PRIORITY.includes(value)
    ? (value as 'lowest' | 'low' | 'medium' | 'high' | 'highest')
    : undefined
}
function rsvp(args: Record<string, unknown>): 'going' | 'maybe' | 'declined' | 'invited' {
  const value = args.status
  if (typeof value === 'string' && RSVP.includes(value)) {
    return value as 'going' | 'maybe' | 'declined' | 'invited'
  }
  throw new Error('status must be one of going, maybe, declined, invited')
}

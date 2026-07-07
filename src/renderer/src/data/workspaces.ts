// Mock data for the Discord-style shell. Every screen reads through the getters
// below, so swapping these for Convex queries later is localized.

export type Presence = 'online' | 'idle' | 'dnd' | 'offline'
export type ChannelKind = 'chat' | 'voice' | 'page' | 'kanban'

/** An org / workspace (Discord "server"). */
export interface Server {
  id: string
  name: string
  initials: string
  color: string
  mentions?: number
  unread?: boolean
}

export interface Category {
  id: string
  serverId: string
  name: string
}

/** A channel shared across orgs (Slack Connect-style). */
export interface SharedInfo {
  withServerIds: string[]
}

export interface Channel {
  id: string
  serverId: string
  categoryId: string
  name: string
  kind: ChannelKind
  emoji?: string
  topic?: string
  private?: boolean
  unread?: boolean
  mentions?: number
  shared?: SharedInfo
}

export interface Role {
  id: string
  name: string
  color?: string
  hoist?: boolean
}

export interface Member {
  id: string
  name: string
  initials: string
  color: string
  roleId: string
  presence: Presence
  bot?: boolean
  status?: string
}

export interface Reaction {
  emoji: string
  count: number
  reacted?: boolean
}

export interface Embed {
  siteName: string
  title: string
  description: string
  url: string
}

export interface ReplyRef {
  authorId: string
  body: string
}

export interface ThreadSummary {
  id: string
  name: string
  replyCount: number
  lastReplyAgo: string
  participantIds: string[]
}

export interface Message {
  id: string
  channelId: string
  authorId: string
  time: string
  dateDivider?: string
  body: string
  edited?: boolean
  mentionEveryone?: boolean
  reactions?: Reaction[]
  embed?: Embed
  replyTo?: ReplyRef
  thread?: ThreadSummary
}

export interface Thread {
  id: string
  channelId: string
  serverId: string
  name: string
  root: Message
  replies: Message[]
}

export interface Notification {
  id: string
  kind: 'mention' | 'reply' | 'thread'
  serverId: string
  channelId: string
  channelName: string
  authorId: string
  preview: string
  ago: string
  unread: boolean
}

// ---------------------------------------------------------------------------

export const currentUser: Member = {
  id: 'sken',
  name: 'Jamie Fox',
  initials: 'JF',
  color: '#5865f2',
  roleId: 'admin',
  presence: 'offline',
  status: 'Invisible'
}

export const servers: Server[] = [
  { id: 'zinx', name: 'ZiNX', initials: 'Z', color: '#5865f2', unread: true, mentions: 3 },
  { id: 'partners', name: 'ZiNX Partners', initials: 'ZP', color: '#3ba55d' },
  { id: 'gamers', name: 'Gamers United', initials: 'GU', color: '#eb459e', unread: true },
  { id: 'design', name: 'Design Guild', initials: 'DG', color: '#faa61a' },
  { id: 'oss', name: 'OSS Friends', initials: 'OS', color: '#00a8fc' }
]

const ROLES: Role[] = [
  { id: 'bot', name: 'Bot', color: '#5865f2', hoist: true },
  { id: 'admin', name: 'Admin', color: '#f2777a', hoist: true },
  { id: 'mod', name: 'Moderator', color: '#43b581', hoist: true },
  { id: 'member', name: 'Member' }
]

const CATEGORIES: Record<string, Category[]> = {
  zinx: [
    { id: 'c-info', serverId: 'zinx', name: 'Information' },
    { id: 'c-admins', serverId: 'zinx', name: 'Admins & Mods' },
    { id: 'c-zinx', serverId: 'zinx', name: 'ZiNX.' },
    { id: 'c-docs', serverId: 'zinx', name: 'Docs' },
    { id: 'c-voice', serverId: 'zinx', name: 'Voice' }
  ],
  partners: [{ id: 'p-main', serverId: 'partners', name: 'Shared' }],
  gamers: [{ id: 'g-main', serverId: 'gamers', name: 'Text Channels' }],
  design: [{ id: 'd-main', serverId: 'design', name: 'Text Channels' }],
  oss: [{ id: 'o-main', serverId: 'oss', name: 'Text Channels' }]
}

const CHANNELS: Record<string, Channel[]> = {
  zinx: [
    {
      id: 'welcome',
      serverId: 'zinx',
      categoryId: 'c-info',
      name: 'welcome',
      kind: 'chat',
      emoji: '👋'
    },
    {
      id: 'rules',
      serverId: 'zinx',
      categoryId: 'c-info',
      name: 'rules',
      kind: 'chat',
      emoji: '📋'
    },
    {
      id: 'server-announcements',
      serverId: 'zinx',
      categoryId: 'c-info',
      name: 'server-announcements',
      kind: 'chat',
      emoji: '📣'
    },
    {
      id: 'feature-announcements',
      serverId: 'zinx',
      categoryId: 'c-info',
      name: 'feature-announcements',
      kind: 'chat',
      emoji: '📣'
    },
    {
      id: 'giveaways',
      serverId: 'zinx',
      categoryId: 'c-info',
      name: 'giveaways',
      kind: 'chat',
      emoji: '🎉'
    },
    {
      id: 'social-links',
      serverId: 'zinx',
      categoryId: 'c-info',
      name: 'social-links',
      kind: 'chat',
      emoji: '🔗'
    },
    {
      id: 'introduction',
      serverId: 'zinx',
      categoryId: 'c-info',
      name: 'introduction',
      kind: 'chat',
      emoji: '🙋'
    },
    {
      id: 'zinx-apps',
      serverId: 'zinx',
      categoryId: 'c-info',
      name: 'zinx-apps',
      kind: 'chat',
      emoji: '🌱'
    },
    {
      id: 'admins',
      serverId: 'zinx',
      categoryId: 'c-admins',
      name: 'admins',
      kind: 'chat',
      private: true,
      emoji: '🔒'
    },
    {
      id: 'moderators',
      serverId: 'zinx',
      categoryId: 'c-admins',
      name: 'moderators',
      kind: 'chat',
      private: true,
      emoji: '🛡️'
    },
    {
      id: 'zinx',
      serverId: 'zinx',
      categoryId: 'c-zinx',
      name: 'zinx',
      kind: 'chat',
      topic: 'Everything about the ZiNX app',
      unread: true,
      mentions: 2,
      shared: { withServerIds: ['partners'] }
    },
    {
      id: 'business-talks',
      serverId: 'zinx',
      categoryId: 'c-zinx',
      name: 'business-talks',
      kind: 'chat'
    },
    {
      id: 'voice-general',
      serverId: 'zinx',
      categoryId: 'c-voice',
      name: 'General',
      kind: 'voice'
    },
    { id: 'voice-music', serverId: 'zinx', categoryId: 'c-voice', name: 'Music', kind: 'voice' },
    {
      id: 'roadmap',
      serverId: 'zinx',
      categoryId: 'c-docs',
      name: 'roadmap',
      kind: 'page',
      emoji: '🗺️'
    },
    {
      id: 'handbook',
      serverId: 'zinx',
      categoryId: 'c-docs',
      name: 'handbook',
      kind: 'page',
      emoji: '📘'
    },
    {
      id: 'meeting-notes',
      serverId: 'zinx',
      categoryId: 'c-docs',
      name: 'meeting-notes',
      kind: 'page',
      emoji: '📝'
    },
    {
      id: 'sprint-board',
      serverId: 'zinx',
      categoryId: 'c-docs',
      name: 'sprint-board',
      kind: 'kanban',
      emoji: '📋'
    }
  ],
  partners: [
    {
      id: 'zinx',
      serverId: 'partners',
      categoryId: 'p-main',
      name: 'zinx',
      kind: 'chat',
      shared: { withServerIds: ['zinx'] },
      topic: 'Shared with ZiNX'
    },
    {
      id: 'partner-updates',
      serverId: 'partners',
      categoryId: 'p-main',
      name: 'partner-updates',
      kind: 'chat'
    }
  ],
  gamers: [
    {
      id: 'general',
      serverId: 'gamers',
      categoryId: 'g-main',
      name: 'general',
      kind: 'chat',
      unread: true
    },
    {
      id: 'lfg',
      serverId: 'gamers',
      categoryId: 'g-main',
      name: 'looking-for-group',
      kind: 'chat'
    },
    { id: 'clips', serverId: 'gamers', categoryId: 'g-main', name: 'clips', kind: 'chat' }
  ],
  design: [
    { id: 'general', serverId: 'design', categoryId: 'd-main', name: 'general', kind: 'chat' },
    {
      id: 'critique',
      serverId: 'design',
      categoryId: 'd-main',
      name: 'critique',
      kind: 'chat',
      mentions: 5
    }
  ],
  oss: [
    { id: 'general', serverId: 'oss', categoryId: 'o-main', name: 'general', kind: 'chat' },
    {
      id: 'releases',
      serverId: 'oss',
      categoryId: 'o-main',
      name: 'releases',
      kind: 'chat',
      emoji: '📣'
    }
  ]
}

const MEMBERS: Record<string, Member[]> = {
  zinx: [
    {
      id: 'sapphire',
      name: 'Assistant',
      initials: 'AS',
      color: '#5865f2',
      roleId: 'bot',
      presence: 'online',
      bot: true,
      status: 'Online'
    },
    {
      id: 'voicemaster',
      name: 'Music',
      initials: 'MU',
      color: '#1abc9c',
      roleId: 'bot',
      presence: 'online',
      bot: true,
      status: 'Playing music · /help'
    },
    {
      id: 'ada',
      name: 'Alex Morgan',
      initials: 'AM',
      color: '#8b5cf6',
      roleId: 'admin',
      presence: 'online',
      status: 'Heads down'
    },
    {
      id: 'grace',
      name: 'Sam Rivera',
      initials: 'SR',
      color: '#e67e22',
      roleId: 'mod',
      presence: 'dnd',
      status: 'Do not disturb'
    },
    {
      id: 'zoro',
      name: 'Jordan Lee',
      initials: 'JL',
      color: '#e74c3c',
      roleId: 'member',
      presence: 'idle'
    },
    {
      id: 'dragondonn',
      name: 'Casey Kim',
      initials: 'CK',
      color: '#2ecc71',
      roleId: 'member',
      presence: 'offline'
    },
    {
      id: 'makadoks',
      name: 'Taylor Brooks',
      initials: 'TB',
      color: '#e91e63',
      roleId: 'member',
      presence: 'offline'
    },
    {
      id: 'manish',
      name: 'Riley Chen',
      initials: 'RC',
      color: '#3498db',
      roleId: 'member',
      presence: 'offline'
    },
    {
      id: 'sken',
      name: 'Jamie Fox',
      initials: 'JF',
      color: '#5865f2',
      roleId: 'admin',
      presence: 'offline',
      status: 'Invisible'
    }
  ]
}

function messagesForZinx(): Message[] {
  return [
    {
      id: 'z-sys',
      channelId: 'zinx',
      authorId: 'sapphire',
      time: '',
      dateDivider: 'January 6, 2026',
      body: ''
    },
    {
      id: 'z1',
      channelId: 'zinx',
      authorId: 'sken',
      time: '1/6/2026 8:50 PM',
      mentionEveryone: true,
      body: 'I was testing our cursor and its basic tier to build stuff. This is the result:',
      edited: true,
      reactions: [
        { emoji: '🎉', count: 1, reacted: true },
        { emoji: '🔥', count: 4 }
      ],
      embed: {
        siteName: 'Zinx Type',
        title: 'Zinx Type — Free Online Typing Test & Practice',
        description:
          'Improve your typing speed and accuracy with Zinx Type. Free online typing test with multiple modes, quotes, and real-time WPM tracking.',
        url: 'https://zinx-type.vercel.app/'
      }
    },
    {
      id: 'z2',
      channelId: 'zinx',
      authorId: 'ada',
      time: '1/6/2026 8:58 PM',
      replyTo: { authorId: 'sken', body: 'I was testing our cursor and its basic tier…' },
      body: 'This looks great! The real-time WPM tracking is a really nice touch 🙌',
      reactions: [{ emoji: '💯', count: 2 }]
    },
    {
      id: 'z3',
      channelId: 'zinx',
      authorId: 'sken',
      time: '2/18/2026 7:04 PM',
      dateDivider: 'February 18, 2026',
      mentionEveryone: true,
      body: 'Testing link if anyone wants to get involved: https://zinx-app.netlify.app/',
      thread: {
        id: 't-launch',
        name: 'Launch feedback',
        replyCount: 12,
        lastReplyAgo: '2h ago',
        participantIds: ['ada', 'grace', 'zoro', 'voicemaster']
      }
    },
    {
      id: 'z4',
      channelId: 'zinx',
      authorId: 'grace',
      time: '2/18/2026 7:12 PM',
      body: 'Deploying the preview now — will drop notes in the thread. Nanoseconds matter ⚡',
      reactions: [
        { emoji: '⚡', count: 3 },
        { emoji: '👀', count: 1 }
      ]
    }
  ]
}

const THREADS: Record<string, Thread> = {
  't-launch': {
    id: 't-launch',
    channelId: 'zinx',
    serverId: 'zinx',
    name: 'Launch feedback',
    root: {
      id: 'z3',
      channelId: 'zinx',
      authorId: 'sken',
      time: '2/18/2026 7:04 PM',
      body: 'Testing link if anyone wants to get involved: https://zinx-app.netlify.app/'
    },
    replies: [
      {
        id: 'tr1',
        channelId: 'zinx',
        authorId: 'ada',
        time: '7:06 PM',
        body: 'Signed up — onboarding was smooth. One nit: the empty state could use a CTA.'
      },
      {
        id: 'tr2',
        channelId: 'zinx',
        authorId: 'zoro',
        time: '7:20 PM',
        body: 'Threads feel way nicer here than Slack tbh.',
        reactions: [{ emoji: '💯', count: 2 }]
      },
      {
        id: 'tr3',
        channelId: 'zinx',
        authorId: 'grace',
        time: '9:03 PM',
        body: 'Perf looks solid on my machine. Will profile the message list next.'
      }
    ]
  },
  't-onboarding': {
    id: 't-onboarding',
    channelId: 'zinx',
    serverId: 'zinx',
    name: 'Onboarding polish',
    root: {
      id: 'to-r',
      channelId: 'zinx',
      authorId: 'ada',
      time: 'Mon 10:12 AM',
      body: 'Splitting onboarding into 3 steps — draft in Figma. Thoughts?'
    },
    replies: [
      {
        id: 'to-1',
        channelId: 'zinx',
        authorId: 'grace',
        time: '10:20 AM',
        body: 'Step 2 feels heavy. Can we defer the workspace import?'
      }
    ]
  },
  't-perf': {
    id: 't-perf',
    channelId: 'zinx',
    serverId: 'zinx',
    name: 'Perf profiling',
    root: {
      id: 'tp-r',
      channelId: 'zinx',
      authorId: 'grace',
      time: 'Tue 3:02 PM',
      body: 'Message list re-renders on every keystroke — memoizing rows.'
    },
    replies: [
      {
        id: 'tp-1',
        channelId: 'zinx',
        authorId: 'zoro',
        time: '3:15 PM',
        body: 'Nice, that was janky on long channels.'
      }
    ]
  },
  't-icons': {
    id: 't-icons',
    channelId: 'zinx',
    serverId: 'zinx',
    name: 'Icon set v2',
    root: {
      id: 'ti-r',
      channelId: 'zinx',
      authorId: 'makadoks',
      time: 'Wed 1:40 PM',
      body: 'Swapping to Phosphor duotone for the empty states.'
    },
    replies: [
      {
        id: 'ti-1',
        channelId: 'zinx',
        authorId: 'ada',
        time: '1:52 PM',
        body: 'Love it. Keep the rail icons filled though.'
      }
    ]
  },
  't-darkmode': {
    id: 't-darkmode',
    channelId: 'zinx',
    serverId: 'zinx',
    name: 'Dark mode contrast bug',
    root: {
      id: 'td-r',
      channelId: 'zinx',
      authorId: 'zoro',
      time: 'Wed 6:11 PM',
      body: 'Muted text fails contrast on the sidebar in dark.'
    },
    replies: [
      {
        id: 'td-1',
        channelId: 'zinx',
        authorId: 'grace',
        time: '6:19 PM',
        body: 'Bumping --muted-foreground a notch. PR incoming.'
      }
    ]
  },
  't-release': {
    id: 't-release',
    channelId: 'zinx',
    serverId: 'zinx',
    name: 'Release 0.3 checklist',
    root: {
      id: 'trl-r',
      channelId: 'zinx',
      authorId: 'sken',
      time: 'Thu 9:00 AM',
      body: 'Cutting 0.3 Friday. Checklist in the doc — claim items.'
    },
    replies: [
      {
        id: 'trl-1',
        channelId: 'zinx',
        authorId: 'ada',
        time: '9:05 AM',
        body: 'I will take changelog + screenshots.'
      }
    ]
  }
}

const NOTIFICATIONS: Notification[] = [
  {
    id: 'n1',
    kind: 'mention',
    serverId: 'zinx',
    channelId: 'zinx',
    channelName: 'zinx',
    authorId: 'ada',
    preview: '@Jamie can you review the launch checklist?',
    ago: '5m',
    unread: true
  },
  {
    id: 'n2',
    kind: 'reply',
    serverId: 'zinx',
    channelId: 'zinx',
    channelName: 'zinx',
    authorId: 'grace',
    preview: 'Replied to you: deploying the preview now…',
    ago: '18m',
    unread: true
  },
  {
    id: 'n3',
    kind: 'thread',
    serverId: 'zinx',
    channelId: 'zinx',
    channelName: 'Launch feedback',
    authorId: 'zoro',
    preview: 'Threads feel way nicer here than Slack tbh.',
    ago: '2h',
    unread: false
  },
  {
    id: 'n4',
    kind: 'mention',
    serverId: 'design',
    channelId: 'critique',
    channelName: 'critique',
    authorId: 'makadoks',
    preview: '@Jamie thoughts on the new palette?',
    ago: '1d',
    unread: false
  }
]

// --- getters ---------------------------------------------------------------

export function getServer(id: string): Server | undefined {
  return servers.find((s) => s.id === id)
}

export function getCategories(serverId: string): Category[] {
  return CATEGORIES[serverId] ?? []
}

export function getChannels(serverId: string): Channel[] {
  return CHANNELS[serverId] ?? []
}

export function getChannelsInCategory(serverId: string, categoryId: string): Channel[] {
  return getChannels(serverId).filter((c) => c.categoryId === categoryId)
}

export function getChannel(serverId: string, channelId: string): Channel | undefined {
  return getChannels(serverId).find((c) => c.id === channelId)
}

// Notion-style page documents (for `kind: 'page'` channels).
export type PageBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'numbered'; number: number; text: string }
  | { type: 'todo'; text: string; checked: boolean }
  | { type: 'quote'; text: string }
  | { type: 'callout'; emoji: string; text: string }
  | { type: 'code'; text: string }
  | { type: 'divider' }

export interface Page {
  channelId: string
  icon: string
  cover?: string // a gradient key ("gradient:<name>") or an image URL
  title: string
  subtitle?: string
  blocks: PageBlock[]
}

const PAGES: Record<string, Page> = {
  roadmap: {
    channelId: 'roadmap',
    icon: '🗺️',
    cover: 'gradient:aurora',
    title: 'Product Roadmap',
    subtitle: 'Where ZiNX is headed this quarter.',
    blocks: [
      {
        type: 'callout',
        emoji: '📌',
        text: 'This doc is the source of truth for the roadmap. Update it as things ship.'
      },
      { type: 'heading', level: 2, text: 'Now' },
      { type: 'todo', text: 'Nestable channel sidebar with drag-and-drop', checked: true },
      { type: 'todo', text: 'Page channels (Notion-style docs)', checked: false },
      { type: 'todo', text: 'Cross-org shared channels', checked: false },
      { type: 'heading', level: 2, text: 'Next' },
      { type: 'bullet', text: 'Voice channels with screen share' },
      { type: 'bullet', text: 'Command-palette actions (create channel, invite)' },
      { type: 'bullet', text: 'Slash commands in the composer' },
      { type: 'heading', level: 2, text: 'Later' },
      { type: 'numbered', number: 1, text: 'Mobile app (Capacitor)' },
      { type: 'numbered', number: 2, text: 'Public API + webhooks' },
      { type: 'numbered', number: 3, text: 'End-to-end encrypted DMs' },
      { type: 'divider' },
      { type: 'quote', text: 'Ship small, ship often.' }
    ]
  },
  handbook: {
    channelId: 'handbook',
    icon: '📘',
    cover: 'gradient:ocean',
    title: 'Team Handbook',
    subtitle: 'How we work.',
    blocks: [
      { type: 'heading', level: 2, text: 'Communication' },
      {
        type: 'paragraph',
        text: 'Default to async. Use chat channels for discussion and page channels for anything that should outlive the scroll.'
      },
      { type: 'bullet', text: 'Start a thread for anything longer than two replies.' },
      { type: 'bullet', text: 'Keep #general low-noise.' },
      { type: 'heading', level: 2, text: 'Working hours' },
      {
        type: 'paragraph',
        text: 'We are fully remote and async-first. Set your status when you are heads-down.'
      },
      {
        type: 'callout',
        emoji: '💡',
        text: 'No meeting has to be a meeting — try a page + comments first.'
      },
      { type: 'heading', level: 2, text: 'Code' },
      { type: 'code', text: 'pnpm dev    # run the app\npnpm build  # typecheck + build' }
    ]
  },
  'meeting-notes': {
    channelId: 'meeting-notes',
    icon: '📝',
    title: 'Weekly Sync — Notes',
    subtitle: 'February 18, 2026',
    blocks: [
      { type: 'heading', level: 3, text: 'Attendees' },
      { type: 'paragraph', text: 'Alex Morgan, Sam Rivera, Jordan Lee, Jamie Fox' },
      { type: 'heading', level: 3, text: 'Decisions' },
      { type: 'todo', text: 'Cut 0.3 on Friday', checked: true },
      { type: 'todo', text: 'Prioritise page channels ahead of voice', checked: true },
      { type: 'heading', level: 3, text: 'Action items' },
      { type: 'todo', text: 'Jamie: changelog + screenshots', checked: false },
      { type: 'todo', text: 'Sam: profile the message list', checked: false },
      { type: 'todo', text: 'Alex: onboarding polish', checked: false }
    ]
  }
}

export function getPage(channelId: string): Page {
  return (
    PAGES[channelId] ?? {
      channelId,
      icon: '📄',
      title: channelId,
      blocks: [{ type: 'paragraph', text: 'This page is empty. Start writing…' }]
    }
  )
}

// ── Kanban (project board) channels ──────────────────────────────────────────
export type TaskPriority = 'lowest' | 'low' | 'medium' | 'high' | 'highest'

export interface ChecklistItem {
  id: string
  content: string
  completed: boolean
}

export interface KanbanTask {
  id: string
  title: string
  description?: string
  priority: TaskPriority
  assigneeIds?: string[]
  dueDate?: string // ISO date
  labels?: string[]
  storyPoints?: number
  checklist?: ChecklistItem[]
}

/** A column on the board (`_zinx` calls this a "board"; a channel holds several). */
export interface KanbanColumn {
  id: string
  title: string
  tasks: KanbanTask[]
}

export interface Board {
  channelId: string
  columns: KanbanColumn[]
}

const BOARDS: Record<string, Board> = {
  'sprint-board': {
    channelId: 'sprint-board',
    columns: [
      {
        id: 'todo',
        title: 'To Do',
        tasks: [
          {
            id: 'k1',
            title: 'Design the onboarding flow',
            priority: 'high',
            assigneeIds: ['ada'],
            labels: ['design'],
            dueDate: '2026-07-14',
            storyPoints: 5
          },
          {
            id: 'k2',
            title: 'Draft the Q3 marketing plan',
            priority: 'medium',
            assigneeIds: ['grace'],
            labels: ['marketing', 'planning'],
            storyPoints: 3
          },
          {
            id: 'k3',
            title: 'Audit accessibility on the settings dialog',
            priority: 'low',
            labels: ['review']
          }
        ]
      },
      {
        id: 'in-progress',
        title: 'In Progress',
        tasks: [
          {
            id: 'k4',
            title: 'Build the kanban channel',
            description: 'Columns, cards, drag-and-drop between columns.',
            priority: 'highest',
            assigneeIds: ['sken', 'zoro'],
            labels: ['content'],
            dueDate: '2026-07-08',
            storyPoints: 8,
            checklist: [
              { id: 'c1', content: 'Columns + cards', completed: true },
              { id: 'c2', content: 'Drag & drop (cards + columns)', completed: true },
              { id: 'c3', content: 'Task detail dialog', completed: false },
              { id: 'c4', content: 'Wire to Convex', completed: false }
            ]
          },
          {
            id: 'k5',
            title: 'Wire Convex behind the data getters',
            priority: 'high',
            assigneeIds: ['zoro'],
            labels: ['research'],
            storyPoints: 5
          }
        ]
      },
      {
        id: 'review',
        title: 'Review',
        tasks: [
          {
            id: 'k6',
            title: 'Theme BlockNote to app tokens',
            priority: 'medium',
            assigneeIds: ['dragondonn'],
            labels: ['design', 'review'],
            storyPoints: 2
          }
        ]
      },
      {
        id: 'done',
        title: 'Done',
        tasks: [
          {
            id: 'k7',
            title: 'Set up electron-vite + Tailwind',
            priority: 'medium',
            assigneeIds: ['manish'],
            labels: ['admin'],
            storyPoints: 3
          },
          {
            id: 'k8',
            title: 'Command palette (⌘K)',
            priority: 'low',
            assigneeIds: ['makadoks'],
            storyPoints: 2
          }
        ]
      }
    ]
  }
}

export function getBoard(channelId: string): Board {
  return (
    BOARDS[channelId] ?? {
      channelId,
      columns: [
        { id: 'todo', title: 'To Do', tasks: [] },
        { id: 'in-progress', title: 'In Progress', tasks: [] },
        { id: 'done', title: 'Done', tasks: [] }
      ]
    }
  )
}

// Nestable sidebar outline: groups can contain channels AND sub-groups.
export interface GroupNode {
  type: 'group'
  id: string
  name: string
  children: SidebarNode[]
}
export interface ChannelRefNode {
  type: 'channel'
  channelId: string
}
export type SidebarNode = GroupNode | ChannelRefNode

const SIDEBAR_TREES: Record<string, SidebarNode[]> = {
  zinx: [
    {
      type: 'group',
      id: 'g-start',
      name: 'Start here',
      children: [
        { type: 'channel', channelId: 'welcome' },
        { type: 'channel', channelId: 'rules' },
        { type: 'channel', channelId: 'server-announcements' },
        { type: 'channel', channelId: 'feature-announcements' },
        { type: 'channel', channelId: 'giveaways' },
        { type: 'channel', channelId: 'social-links' },
        { type: 'channel', channelId: 'introduction' },
        { type: 'channel', channelId: 'zinx-apps' }
      ]
    },
    {
      type: 'group',
      id: 'g-zinx',
      name: 'ZiNX',
      children: [
        { type: 'channel', channelId: 'zinx' },
        { type: 'channel', channelId: 'business-talks' },
        {
          type: 'group',
          id: 'g-admins',
          name: 'Admins & Mods',
          children: [
            { type: 'channel', channelId: 'admins' },
            { type: 'channel', channelId: 'moderators' }
          ]
        }
      ]
    },
    {
      type: 'group',
      id: 'g-docs',
      name: 'Docs',
      children: [
        { type: 'channel', channelId: 'roadmap' },
        { type: 'channel', channelId: 'handbook' },
        { type: 'channel', channelId: 'meeting-notes' }
      ]
    },
    {
      type: 'group',
      id: 'g-project',
      name: 'Project',
      children: [{ type: 'channel', channelId: 'sprint-board' }]
    },
    {
      type: 'group',
      id: 'g-voice',
      name: 'Voice',
      children: [
        { type: 'channel', channelId: 'voice-general' },
        { type: 'channel', channelId: 'voice-music' }
      ]
    }
  ]
}

export function getSidebarTree(serverId: string): SidebarNode[] {
  const tree = SIDEBAR_TREES[serverId]
  if (tree) return tree
  return getCategories(serverId).map((category) => ({
    type: 'group' as const,
    id: category.id,
    name: category.name,
    children: getChannelsInCategory(serverId, category.id).map((channel) => ({
      type: 'channel' as const,
      channelId: channel.id
    }))
  }))
}

export function getRole(roleId: string): Role | undefined {
  return ROLES.find((r) => r.id === roleId)
}

export function getMembers(serverId: string): Member[] {
  return MEMBERS[serverId] ?? MEMBERS.zinx
}

export function getMember(serverId: string, memberId: string): Member | undefined {
  return (
    getMembers(serverId).find((m) => m.id === memberId) ??
    getMembers('zinx').find((m) => m.id === memberId)
  )
}

export function getMessages(channelId: string): Message[] {
  if (channelId === 'zinx') return messagesForZinx()
  return [
    {
      id: `${channelId}-1`,
      channelId,
      authorId: 'ada',
      time: 'Today at 9:41 AM',
      dateDivider: 'Today',
      body: `Welcome to #${channelId} — this is the start of the channel.`
    }
  ]
}

export function getThread(threadId: string): Thread | undefined {
  return THREADS[threadId]
}

export function getThreadsForServer(serverId: string): Thread[] {
  return Object.values(THREADS).filter((t) => t.serverId === serverId)
}

export function getThreadsForChannel(channelId: string): Thread[] {
  return Object.values(THREADS).filter((t) => t.channelId === channelId)
}

export function getNotifications(): Notification[] {
  return NOTIFICATIONS
}

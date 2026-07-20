import { Check, LockSimple, Megaphone, ShieldCheck } from '@phosphor-icons/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'

/**
 * A per-channel "what is this and how do I use it" modal, opened by the `?` in the channel
 * header. The content is keyed on the channel KIND (so a page channel explains pages, a
 * database explains tables, etc.), and it ends with **permission-aware** notes derived from
 * the channel doc + the caller's role — so a member sees "read-only", an admin sees "you
 * can manage this".
 */

type HelpEntry = { label: string; summary: string; features: string[] }

const HELP: Record<string, HelpEntry> = {
  chat: {
    label: 'Text channel',
    summary: 'A conversation on a topic — messages, threads, reactions, files and more.',
    features: [
      'Send rich messages with Markdown, emoji, GIFs and file attachments',
      'Reply inline to quote a message, or start a thread for a side conversation',
      'React with emoji, pin important messages, and @mention people or #channels',
      'Everything is searchable — use ⌘K, with from:/in:/has:/before:/after: filters'
    ]
  },
  voice: {
    label: 'Voice channel',
    summary: 'A always-on call room — click to join, talk, share video or your screen.',
    features: [
      'Join instantly by opening the channel; leave any time',
      'Camera, screen share (with system audio), and per-person volume controls',
      'A Discord-style stage: spotlight a screen share, filmstrip of everyone else',
      'See who’s connected in the sidebar, with their mic / camera / share state'
    ]
  },
  page: {
    label: 'Page',
    summary: 'A Notion-style document — rich text, media, and embeds, with a cover and icon.',
    features: [
      'Headings, lists, to-dos, quotes, callouts, code blocks (syntax-highlighted) and tables',
      'Upload images, video, audio and files, or embed YouTube / Vimeo',
      '@mention people and #channels inline; a table of contents tracks your headings',
      'Autosaves as you type; add a cover image and an emoji icon'
    ]
  },
  kanban: {
    label: 'Board',
    summary: 'A project board — columns of cards you drag between statuses.',
    features: [
      'Add columns and drag cards between them; reorder within a column',
      'Each card has a priority, assignees, labels, a due date and a checklist',
      'A rich description editor, and a done-progress badge from the checklist',
      'Cards assigned to you are highlighted'
    ]
  },
  whiteboard: {
    label: 'Whiteboard',
    summary: 'An infinite canvas for diagrams, sketches and freeform thinking (Excalidraw).',
    features: [
      'Draw shapes, arrows, text and freehand; everything autosaves',
      'A hand-drawn style that’s great for architecture and flow diagrams',
      'Themed to the app’s light/dark mode'
    ]
  },
  database: {
    label: 'Database',
    summary: 'An Airtable-style table of records with typed fields and multiple views.',
    features: [
      'Fields of many types: text, number, select, multi-select, checkbox, date, person, URL',
      'A fast, virtualized Grid view with resizable columns — good for thousands of rows',
      'A Board view that groups records by a Select field, with drag-and-drop',
      'Add fields and records inline; everything saves instantly'
    ]
  },
  form: {
    label: 'Form',
    summary: 'A form that collects responses — share a link, answers land here.',
    features: [
      'Many field types: short/long text, number, email, URL, date, checkbox, dropdown, multiple choice',
      'Choose who can submit: anyone with the link, any signed-in user, or only this workspace',
      'Share a public link (rotate it any time to revoke the old one)',
      'Browse every response in the Responses tab'
    ]
  },
  dm: {
    label: 'Direct message',
    summary: 'A private conversation between you and one or more people.',
    features: [
      'Messages, reactions, replies and file attachments — just for the two (or few) of you',
      'Nobody else in the workspace can see it'
    ]
  }
}

export function ChannelHelpDialog({
  channel,
  canManage,
  open,
  onOpenChange
}: {
  /** Only the display-relevant fields — so both a Convex `Doc<'channels'>` and a local
   *  channel (which has no visibility/posting policy) can pass one. */
  channel: { kind: string; visibility?: string; postingPolicy?: string }
  canManage: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const help = HELP[channel.kind] ?? HELP.chat

  const permissionNotes: Array<{ icon: React.ReactNode; text: string }> = []
  if (channel.visibility === 'private') {
    permissionNotes.push({
      icon: <LockSimple className="size-4 text-muted-foreground" weight="fill" />,
      text: 'This is a private channel — only people who’ve been added can see it.'
    })
  }
  if (channel.postingPolicy === 'admins') {
    permissionNotes.push({
      icon: <Megaphone className="size-4 text-muted-foreground" />,
      text: 'Announcement channel — only owners and admins can post; everyone else can read.'
    })
  } else if (channel.postingPolicy === 'selected') {
    permissionNotes.push({
      icon: <Megaphone className="size-4 text-muted-foreground" />,
      text: 'Only certain people can post here; everyone else can read.'
    })
  }
  if (canManage) {
    permissionNotes.push({
      icon: <ShieldCheck className="size-4 text-primary" weight="fill" />,
      text: 'You can manage this channel — its settings, who can post, and who has access.'
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ChannelKindIcon kind={channel.kind} className="size-5 text-primary" />
            {help.label}
          </DialogTitle>
          <DialogDescription>{help.summary}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <h4 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
              What you can do here
            </h4>
            <ul className="space-y-1.5">
              {help.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" weight="bold" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          {permissionNotes.length > 0 ? (
            <div>
              <h4 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
                Your access
              </h4>
              <ul className="space-y-1.5">
                {permissionNotes.map((note, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="mt-0.5 shrink-0">{note.icon}</span>
                    <span>{note.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

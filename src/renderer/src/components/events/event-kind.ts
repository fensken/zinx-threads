import { Bell, Flag, Tag, Users, type Icon } from '@phosphor-icons/react'

/** What kind of event. Colours the calendar chip and drives the Type filter. */
export type EventKind = 'meeting' | 'deadline' | 'reminder' | 'other'

export const EVENT_KINDS: EventKind[] = ['meeting', 'deadline', 'reminder', 'other']

/**
 * Per-kind presentation. The dot colours are **categorical** (like presence dots) — an
 * exception to the theme-token rule (see CLAUDE.md): meeting/deadline/reminder/other must
 * stay distinguishable from each other regardless of the palette, so they use fixed hues,
 * never `--primary`.
 */
export const KIND_META: Record<
  EventKind,
  { label: string; icon: Icon; dot: string; chip: string }
> = {
  meeting: {
    label: 'Meeting',
    icon: Users,
    dot: 'bg-blue-500',
    chip: 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
  },
  deadline: {
    label: 'Deadline',
    icon: Flag,
    dot: 'bg-red-500',
    chip: 'bg-red-500/10 text-red-600 dark:text-red-400'
  },
  reminder: {
    label: 'Reminder',
    icon: Bell,
    dot: 'bg-amber-500',
    chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
  },
  other: {
    label: 'Other',
    icon: Tag,
    dot: 'bg-slate-400',
    chip: 'bg-slate-400/15 text-slate-600 dark:text-slate-300'
  }
}

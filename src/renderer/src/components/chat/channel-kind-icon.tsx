import { FileText, Hash, Kanban, PenNib, SpeakerHigh } from '@phosphor-icons/react'

/** One icon per `channel.kind`, so a channel reads the same in the sidebar, the
 *  header, the `#` autocomplete and a rendered `#mention`. */
export function ChannelKindIcon({
  kind,
  className
}: {
  kind: string
  className?: string
}): React.JSX.Element {
  if (kind === 'voice') return <SpeakerHigh className={className} />
  if (kind === 'page') return <FileText className={className} />
  if (kind === 'kanban') return <Kanban className={className} />
  if (kind === 'whiteboard') return <PenNib className={className} />
  return <Hash className={className} />
}

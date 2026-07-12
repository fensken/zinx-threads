import { useState } from 'react'
import { PencilSimple } from '@phosphor-icons/react'

import { IconButton } from '@renderer/components/common/icon-button'
import { RenameField } from '@renderer/components/chat/rename-field'

/** The channel name in the header, renameable in place.
 *
 *  Two ways in, matching the sidebar row: double-click the name, or the pencil
 *  that appears on hover (which is also what makes it reachable by keyboard —
 *  `onDoubleClick` alone is mouse-only). Both swap the label for the same
 *  `RenameField` the sidebar uses, so renaming reads identically wherever you
 *  start it. The caller only hears about a name that is non-empty and actually
 *  different; slugifying is the server's job (`channels.rename`). */
export function EditableChannelName({
  name,
  icon,
  onRename,
  trailing
}: {
  name: string
  icon: React.ReactNode
  onRename: (name: string) => void
  /** Badges that sit after the name (shared-channel indicator, topic, …). */
  trailing?: React.ReactNode
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <RenameField
        initial={name}
        leading={icon}
        className="min-w-0 flex-1"
        inputClassName="font-semibold text-foreground"
        onCancel={() => setEditing(false)}
        onSubmit={(next) => {
          const clean = next.trim()
          if (clean && clean !== name) onRename(clean)
          setEditing(false)
        }}
      />
    )
  }

  return (
    <div className="group/name flex min-w-0 items-center gap-1.5">
      {icon}
      <span
        onDoubleClick={() => setEditing(true)}
        title="Double-click to rename"
        className="truncate font-semibold text-foreground select-none"
      >
        {name}
      </span>
      <IconButton
        label="Rename channel"
        className="size-6 shrink-0 opacity-0 transition-opacity group-hover/name:opacity-100 focus-visible:opacity-100"
        onClick={() => setEditing(true)}
      >
        <PencilSimple className="size-4" />
      </IconButton>
      {trailing}
    </div>
  )
}

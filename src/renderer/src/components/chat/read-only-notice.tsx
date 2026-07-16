import { LockSimple } from '@phosphor-icons/react'

/**
 * What sits where the composer would, in a channel you can read but not write in.
 *
 * It occupies the composer's box — same padding, same height, same rounded border — so
 * switching between a channel you can post in and one you can't doesn't move the message
 * list under the reader's eyes (the no-layout-shift rule).
 *
 * The composer is **removed**, not disabled: a text box you can type into and then can't
 * send from is a trap. Saying why, once, is kinder than a greyed-out button.
 */
export function ReadOnlyNotice({
  postingPolicy
}: {
  postingPolicy?: 'everyone' | 'admins' | 'selected'
}): React.JSX.Element {
  return (
    <div className="shrink-0 px-4 pb-2">
      <div className="flex min-h-11 items-center justify-center gap-2 rounded-lg border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
        <LockSimple weight="fill" className="size-4 shrink-0" />
        <span>
          {postingPolicy === 'selected'
            ? 'Only certain people can post in this channel.'
            : 'Only owners and admins can post in this channel.'}
        </span>
      </div>
    </div>
  )
}

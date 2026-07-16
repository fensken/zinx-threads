import { Megaphone, MicrophoneStage, UsersThree } from '@phosphor-icons/react'
import type { IconWeight } from '@phosphor-icons/react'

export type PostingPolicy = 'everyone' | 'admins' | 'selected'

/**
 * One glyph per posting policy, so a channel reads the same wherever it appears — the
 * settings dialog that sets it and the sidebar row that advertises it.
 *
 * It exists because the two drifted immediately: the sidebar showed a **megaphone** on a
 * channel whose policy was "specific people", which says "announcement" — the wrong answer,
 * confidently. An icon is a claim about state; two places making that claim need one
 * definition. (Same rule as `channel-kind-icon.tsx`.)
 */
export function PostingPolicyIcon({
  policy,
  className,
  weight,
  // Declared explicitly, because TypeScript does NOT check hyphenated JSX attributes on a
  // custom component — an `aria-label` passed to a component that doesn't take one compiles
  // fine and then silently reaches nothing.
  'aria-label': ariaLabel
}: {
  policy: PostingPolicy
  className?: string
  weight?: IconWeight
  'aria-label'?: string
}): React.JSX.Element {
  const props = { className, weight, 'aria-label': ariaLabel }
  // A megaphone is broadcast: owner/admins talk, everyone listens.
  if (policy === 'admins') return <Megaphone {...props} />
  // A stage mic is "these people have the mic" — named talkers, everyone else watching.
  if (policy === 'selected') return <MicrophoneStage {...props} />
  return <UsersThree {...props} />
}

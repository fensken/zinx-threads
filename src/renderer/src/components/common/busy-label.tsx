import { Spinner } from '@renderer/components/ui/spinner'

/** Button content that swaps to a spinner + working text while a mutation runs.
 *  Pair with a `disabled={busy}` on the button. Keeps every submit/confirm button
 *  showing the same "something is happening" cue. */
export function BusyLabel({
  busy,
  idle,
  busyText = 'Working…'
}: {
  busy: boolean
  idle: React.ReactNode
  busyText?: string
}): React.JSX.Element {
  if (!busy) return <>{idle}</>
  return (
    <>
      <Spinner className="size-4" />
      {busyText}
    </>
  )
}

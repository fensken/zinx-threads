import type { Id } from '@convex/_generated/dataModel'
import { RealMemberList } from '@renderer/components/chat/real-member-list'
import { RealThreadPanel } from '@renderer/components/chat/real-thread-panel'
import { ResizeHandle } from '@renderer/components/layout/resize-handle'
import { useMediaQuery } from '@renderer/lib/use-media-query'
import { useUiStore } from '@renderer/store/ui-store'

/** The workspace's right panel — a **sibling of the router `<Outlet>`**, not part
 *  of the channel page.
 *
 *  Discord/Slack keep the left sidebar, the content area and the right panel
 *  independent: navigating between channels swaps only the content. Rendering
 *  this inside the channel page meant every channel switch tore it down and
 *  refetched it. Its data is workspace-scoped anyway, so it belongs up here.
 *
 *  Content is the **active thread** if one is open, else the member list — the
 *  two never coexist (`ui-store` enforces that: opening a thread takes the panel,
 *  closing it restores the member-list preference). Each remembers its own width.
 *  Inline resizable column at lg+, right-side overlay below lg. */
export function WorkspaceRightPanel({
  workspaceId,
  workspaceSlug
}: {
  workspaceId: Id<'workspaces'>
  workspaceSlug: string
}): React.JSX.Element | null {
  const memberListOpen = useUiStore((state) => state.memberListOpen)
  const activeThreadId = useUiStore((state) => state.activeThreadId)
  const rightWidth = useUiStore((state) => state.rightWidth)
  const threadWidth = useUiStore((state) => state.threadWidth)
  const isLgUp = useMediaQuery('(min-width: 1024px)')

  // A thread outranks the member list — it's the thing the user just clicked.
  if (!activeThreadId && !memberListOpen) return null

  // Keyed: switching threads must reset the panel's edit / reply / highlight
  // state. Today a loading gap happens to unmount it, but a warm cache (A→B→A)
  // would reuse it and carry a reply target into the wrong thread.
  const content = activeThreadId ? (
    <RealThreadPanel
      key={activeThreadId}
      workspaceSlug={workspaceSlug}
      threadId={activeThreadId as Id<'threads'>}
    />
  ) : (
    <RealMemberList workspaceId={workspaceId} />
  )

  if (isLgUp) {
    return (
      <>
        <ResizeHandle
          onDelta={(dx) => {
            const ui = useUiStore.getState()
            if (ui.activeThreadId) ui.setThreadWidth(ui.threadWidth - dx)
            else ui.setRightWidth(ui.rightWidth - dx)
          }}
        />
        <div
          className="flex shrink-0 border-l border-border"
          style={{ width: activeThreadId ? threadWidth : rightWidth }}
        >
          {content}
        </div>
      </>
    )
  }

  return (
    <>
      <button
        type="button"
        aria-label={activeThreadId ? 'Close thread' : 'Close members'}
        onClick={() => {
          const ui = useUiStore.getState()
          if (ui.activeThreadId) ui.closeThread()
          else ui.setMemberListOpen(false)
        }}
        className="fixed inset-0 z-30 bg-black/40"
      />
      <div className="fixed inset-y-0 right-0 z-40 flex w-[92dvw] max-w-md border-l border-border bg-card shadow-2xl">
        {content}
      </div>
    </>
  )
}

import { useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import { Check, Globe, LockSimple, MagnifyingGlass, Plus, X } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Spinner } from '@renderer/components/ui/spinner'
import { Avatar } from '@renderer/components/common/avatar'
import { ConfirmDialog } from '@renderer/components/common/confirm-dialog'
import { PostingPolicyIcon } from '@renderer/components/chat/channel-policy-icon'
import { useWorkspaceDirectory } from '@renderer/components/chat/workspace-directory-context'
import { initialsOf } from '@renderer/lib/initials'
import { cn } from '@renderer/lib/utils'
import { errorMessage } from '@renderer/lib/convex-error'

type Visibility = 'public' | 'private'
type PostingPolicy = 'everyone' | 'admins' | 'selected'

/** Fire a mutation, surface its `ConvexError` as a toast. Every control here is a live
 *  switch (no Save button), so a rejection has to say so out loud or it just looks stuck. */
async function run(action: Promise<unknown>, fallback: string): Promise<boolean> {
  try {
    await action
    return true
  } catch (err) {
    console.error(err)
    toast.error(errorMessage(err, fallback))
    return false
  }
}

/**
 * One place to answer the two questions people actually ask about a channel:
 * **who can see it** and **who can post in it**. They're kept separate on purpose — a
 * read-only channel is fully visible, and a private channel is fully writable by the people
 * in it. Collapsing them into a single "permission level" is what makes a role matrix hard
 * to reason about; Slack keeps them apart, and so do we.
 *
 * The people list underneath serves both: in a private channel it's the access list, and
 * while posting is restricted to specific people it's also who may talk. One row per person,
 * one toggle each — never a grid of checkboxes.
 */
export function ChannelSettingsDialog({
  channel,
  open,
  onOpenChange
}: {
  channel: {
    _id: Id<'channels'>
    name: string
    isDefault?: boolean
    visibility?: Visibility
    postingPolicy?: PostingPolicy
  }
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const visibility: Visibility = channel.visibility ?? 'public'
  const postingPolicy: PostingPolicy = channel.postingPolicy ?? 'everyone'

  const members = useQuery(
    api.channelMembers.listByChannel,
    open ? { channelId: channel._id } : 'skip'
  )
  const setVisibility = useMutation(api.channelMembers.setVisibility)
  const setPostingPolicy = useMutation(api.channelMembers.setPostingPolicy)
  const setCanPost = useMutation(api.channelMembers.setCanPost)
  const addPeople = useMutation(api.channelMembers.add)
  const removePerson = useMutation(api.channelMembers.remove)

  const [goingPrivate, setGoingPrivate] = useState(false)
  const [adding, setAdding] = useState(false)

  const alreadyIn = useMemo(
    () => new Set((members ?? []).map((person) => person.userId as string)),
    [members]
  )

  // The list is the access list in a private channel and the talker list while posting is
  // restricted — so it means something in exactly those two cases, and is noise otherwise.
  const showPeople = visibility === 'private' || postingPolicy === 'selected'

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>#{channel.name}</DialogTitle>
            <DialogDescription>Who can see this channel, and who can post in it.</DialogDescription>
          </DialogHeader>

          <div className="no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto py-1">
            <section className="space-y-2">
              <Label>Visibility</Label>
              <OptionCard
                selected={visibility === 'public'}
                icon={<Globe className="size-4" />}
                title="Public"
                description="Anyone in the workspace can find and read it."
                onSelect={() =>
                  void run(
                    setVisibility({ channelId: channel._id, visibility: 'public' }),
                    'Could not change visibility'
                  )
                }
              />
              <OptionCard
                selected={visibility === 'private'}
                disabled={channel.isDefault}
                icon={<LockSimple className="size-4" />}
                title="Private"
                description={
                  channel.isDefault
                    ? "The workspace's home channel can't be made private."
                    : 'Only the people below — an admin who isn’t a member can’t read it either.'
                }
                // Going private hides the history from everyone not in the room. One click,
                // workspace-sized blast radius — so it asks first.
                onSelect={() => setGoingPrivate(true)}
              />
            </section>

            <section className="space-y-2">
              <Label>Who can post</Label>
              <OptionCard
                selected={postingPolicy === 'everyone'}
                icon={<PostingPolicyIcon policy="everyone" className="size-4" />}
                title="Everyone"
                description="Anyone who can see the channel can post in it."
                onSelect={() =>
                  void run(
                    setPostingPolicy({ channelId: channel._id, postingPolicy: 'everyone' }),
                    'Could not change posting'
                  )
                }
              />
              <OptionCard
                selected={postingPolicy === 'admins'}
                icon={<PostingPolicyIcon policy="admins" className="size-4" />}
                title="Owners and admins only"
                description="An announcement channel — everyone reads, admins write."
                onSelect={() =>
                  void run(
                    setPostingPolicy({ channelId: channel._id, postingPolicy: 'admins' }),
                    'Could not change posting'
                  )
                }
              />
              <OptionCard
                selected={postingPolicy === 'selected'}
                icon={<PostingPolicyIcon policy="selected" className="size-4" />}
                title="Specific people"
                description="The people below marked “Can post”. Everyone else reads only."
                onSelect={() =>
                  void run(
                    setPostingPolicy({ channelId: channel._id, postingPolicy: 'selected' }),
                    'Could not change posting'
                  )
                }
              />
            </section>

            {showPeople ? (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>
                    {visibility === 'private' ? 'Members' : 'People who can post'}
                    {members ? (
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        {members.length}
                      </span>
                    ) : null}
                  </Label>
                  <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
                    <Plus className="size-4" />
                    Add people
                  </Button>
                </div>

                {members === undefined ? (
                  <div className="flex min-h-24 items-center justify-center">
                    <Spinner className="size-5 text-muted-foreground" />
                  </div>
                ) : members.length === 0 ? (
                  <p className="flex min-h-24 items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground">
                    {postingPolicy === 'selected'
                      ? 'Nobody can post here yet. Add the people who should be able to.'
                      : 'Nobody has been added yet.'}
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {members.map((person) => (
                      <li
                        key={person.userId}
                        className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-accent"
                      >
                        <Avatar
                          initials={initialsOf(person.name)}
                          color={person.color ?? 'slate'}
                          image={person.avatarUrl}
                          className="size-7"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">{person.name}</span>

                        {postingPolicy === 'selected' ? (
                          <Button
                            type="button"
                            variant={person.canPost ? 'secondary' : 'ghost'}
                            size="sm"
                            className="h-7 shrink-0 text-xs"
                            onClick={() =>
                              void run(
                                setCanPost({
                                  channelId: channel._id,
                                  userId: person.userId,
                                  canPost: !person.canPost
                                }),
                                'Could not change posting'
                              )
                            }
                          >
                            {person.canPost ? 'Can post' : 'View only'}
                          </Button>
                        ) : null}

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label={`Remove ${person.name}`}
                          onClick={() =>
                            void run(
                              removePerson({ channelId: channel._id, userId: person.userId }),
                              'Could not remove'
                            )
                          }
                        >
                          <X className="size-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <AddPeopleDialog
        open={adding}
        onOpenChange={setAdding}
        alreadyIn={alreadyIn}
        onAdd={(userIds) =>
          addPeople({ channelId: channel._id, userIds: userIds as Id<'users'>[] })
        }
      />

      <ConfirmDialog
        open={goingPrivate}
        onOpenChange={setGoingPrivate}
        title={`Make #${channel.name} private?`}
        description="Everyone who isn't a member loses access immediately — including the history, and including admins. You can add people back afterwards."
        confirmLabel="Make private"
        destructive={false}
        // `ConfirmDialog` owns the lifecycle: it spins, awaits, closes on success and keeps
        // itself open + toasts on failure. So this just hands back the promise and throws.
        onConfirm={async () => {
          await setVisibility({ channelId: channel._id, visibility: 'private' })
        }}
      />
    </>
  )
}

/** A radio-in-a-card: the whole row is the hit target, which a bare radio input never is. */
function OptionCard({
  selected,
  disabled,
  icon,
  title,
  description,
  onSelect
}: {
  selected: boolean
  disabled?: boolean
  icon: React.ReactNode
  title: string
  description: string
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled || selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border-2 px-3 py-2.5 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border hover:border-muted-foreground/40 hover:bg-accent',
        disabled && !selected && 'cursor-not-allowed opacity-60 hover:border-border hover:bg-card'
      )}
    >
      <span className={cn('mt-0.5 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      {selected ? <Check weight="bold" className="mt-0.5 size-4 shrink-0 text-primary" /> : null}
    </button>
  )
}

/** Search the workspace, tick people, add them. Reads the already-subscribed directory, so
 *  opening it costs no round-trip. */
function AddPeopleDialog({
  open,
  onOpenChange,
  alreadyIn,
  onAdd
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  alreadyIn: Set<string>
  onAdd: (userIds: string[]) => Promise<unknown>
}): React.JSX.Element {
  const directory = useWorkspaceDirectory()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const candidates = useMemo(() => {
    const term = query.trim().toLowerCase()
    return (directory?.members ?? [])
      .filter((person) => !alreadyIn.has(person.userId))
      .filter((person) => !term || person.name.toLowerCase().includes(term))
  }, [directory?.members, alreadyIn, query])

  const close = (): void => {
    onOpenChange(false)
    setQuery('')
    setPicked(new Set())
  }

  const submit = async (): Promise<void> => {
    if (picked.size === 0) return
    setBusy(true)
    const ok = await run(onAdd([...picked]), 'Could not add people')
    setBusy(false)
    if (ok) close()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="flex max-h-[70dvh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add people</DialogTitle>
          <DialogDescription>They&apos;ll get access to this channel.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <MagnifyingGlass className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search people"
            className="pl-8"
          />
        </div>

        <ul className="no-scrollbar min-h-40 flex-1 space-y-0.5 overflow-y-auto">
          {candidates.length === 0 ? (
            <li className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
              {query ? 'Nobody matches that.' : 'Everyone is already here.'}
            </li>
          ) : (
            candidates.map((person) => {
              const on = picked.has(person.userId)
              return (
                <li key={person.userId}>
                  <button
                    type="button"
                    onClick={() =>
                      setPicked((current) => {
                        const next = new Set(current)
                        if (on) next.delete(person.userId)
                        else next.add(person.userId)
                        return next
                      })
                    }
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent"
                  >
                    <Avatar
                      initials={initialsOf(person.name)}
                      color={person.color}
                      image={person.avatarUrl}
                      className="size-7"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{person.name}</span>
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded border',
                        on ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                      )}
                    >
                      {on ? <Check weight="bold" className="size-3" /> : null}
                    </span>
                  </button>
                </li>
              )
            })
          )}
        </ul>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="button" disabled={picked.size === 0 || busy} onClick={() => void submit()}>
            {busy ? <Spinner className="size-4" /> : null}
            Add{picked.size > 0 ? ` ${picked.size}` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { bumpChannelActivity } from './activity'
import { markChannelRead } from './unread'
import { fanOutNotifications } from './notifications'
import { bodyIsSilent } from './messages'

/**
 * Insert a plain-text message into a channel as a given member, and do the bookkeeping every
 * message needs: bump the channel's activity watermark, mark the author's own read marker
 * forward (they've read what they just wrote), and fan out inbox notifications.
 *
 * The ONE definition of "post a message" shared by the write paths that aren't the app's own
 * composer — the MCP `post_message` tool and bot incoming webhooks. **Access + `canPost` must
 * already be checked by the caller** (they resolve the channel differently). No attachments /
 * replies / threads — those live only in the full `messages.send`.
 */
export async function postMessageInChannel(
  ctx: MutationCtx,
  authorId: Id<'users'>,
  channel: Doc<'channels'>,
  accessWorkspaceId: Id<'workspaces'>,
  body: string
): Promise<Id<'messages'>> {
  const createdAt = Date.now()
  const messageId = await ctx.db.insert('messages', {
    channelId: channel._id,
    workspaceId: channel.workspaceId,
    authorId,
    body,
    createdAt,
    // Born with an (empty) reaction summary, like `messages.send`.
    reactions: []
  })
  const message = (await ctx.db.get(messageId))!
  await bumpChannelActivity(ctx, channel, createdAt)
  await markChannelRead(ctx, authorId, channel, createdAt, accessWorkspaceId)
  // A silent message (`@silent` directive) lands in the channel but pings no one — same rule as
  // `messages.send`, so an API/webhook post honours it too.
  if (!bodyIsSilent(body)) {
    await fanOutNotifications(ctx, {
      message,
      channel,
      actorId: authorId,
      replyTarget: null,
      thread: null
    })
  }
  return messageId
}

import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { EMAIL_FROM, resend } from './resend'

// Composes + sends the app's invitation emails. Called (scheduled) from the invite
// mutations. All caller-supplied strings (names, codes) are HTML-escaped — an email
// body is HTML, and a workspace/user name is user-controlled.

/** The base URL for join links in emails. Set `APP_URL` on the deployment for a real
 *  origin; falls back to the dev web server. The code is always shown too, so the
 *  email works even where the link doesn't. */
function appUrl(): string {
  return process.env.APP_URL ?? 'http://localhost:5173'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** A minimal branded shell around the email body. */
function shell(title: string, inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0a0a0a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e5e5">
      <tr><td style="padding:28px 32px 8px">
        <div style="display:inline-flex;align-items:center;gap:8px">
          <span style="display:inline-block;width:28px;height:28px;border-radius:8px;background:#e11d48;color:#fff;text-align:center;line-height:28px;font-weight:700">Z</span>
          <span style="font-weight:700;font-size:16px">Zinx Threads</span>
        </div>
      </td></tr>
      <tr><td style="padding:8px 32px 32px">
        <h1 style="font-size:20px;margin:12px 0 4px">${title}</h1>
        ${inner}
      </td></tr>
    </table>
    <p style="color:#a1a1a1;font-size:12px;margin-top:16px">You received this because someone invited you on Zinx Threads.</p>
  </td></tr></table>
  </body></html>`
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#e11d48;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600;margin:16px 0">${label}</a>`
}

/** Invite a workspace OWNER to a shared channel, with a one-click **accept link**
 *  (`/connect/<token>`). Accepting is still gated on being that workspace's owner. */
export const sendChannelShareInvite = internalMutation({
  args: {
    to: v.string(),
    ownerWorkspaceName: v.string(),
    guestWorkspaceName: v.string(),
    channelName: v.string(),
    inviterName: v.string(),
    token: v.string()
  },
  handler: async (
    ctx,
    { to, ownerWorkspaceName, guestWorkspaceName, channelName, inviterName, token }
  ) => {
    const owner = escapeHtml(ownerWorkspaceName)
    const guest = escapeHtml(guestWorkspaceName)
    const channel = escapeHtml(channelName)
    const inviter = escapeHtml(inviterName)
    const acceptUrl = `${appUrl()}/connect/${encodeURIComponent(token)}`
    const inner = `
      <p style="color:#404040;line-height:1.5;margin:0 0 8px">
        <strong>${inviter}</strong> from <strong>${owner}</strong> invited <strong>${guest}</strong>
        to the shared channel <strong>#${channel}</strong>.
      </p>
      ${button(acceptUrl, 'Review & accept')}
      <p style="color:#737373;font-size:13px;line-height:1.5;margin:0">
        Your members will be able to read and post in <strong>#${channel}</strong>;
        <strong>${owner}</strong> stays in charge of it. You can also accept or decline from your
        invitations in the app.
      </p>`
    await resend.sendEmail(ctx, {
      from: EMAIL_FROM,
      to,
      subject: `${ownerWorkspaceName} shared #${channelName} with you`,
      html: shell(`Shared channel invite`, inner)
    })
  }
})

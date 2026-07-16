/**
 * Secret-token minting, shared by the MCP personal tokens, bot tokens and incoming-webhook
 * secrets. We only ever store the **hash**; the raw token is returned once, at creation.
 * `mintToken` needs `crypto.getRandomValues`, which is non-deterministic and therefore
 * forbidden in a mutation — so it runs in ACTIONS (bot/webhook/token creation).
 */
import { API_TOKEN_PREFIX } from './brand'

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A fresh `zt_…` secret + its hash + a display preview (`zt_` + 8 chars). */
export async function mintToken(): Promise<{
  token: string
  hashedToken: string
  preview: string
}> {
  // 32 random bytes → base64url. The `zt_` prefix (from `brand.ts`) makes a leaked secret
  // greppable + obviously ours (the same reason GitHub prefixes `ghp_`).
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const token = API_TOKEN_PREFIX + toBase64Url(bytes)
  return {
    token,
    hashedToken: await sha256Hex(token),
    preview: token.slice(0, API_TOKEN_PREFIX.length + 8)
  }
}

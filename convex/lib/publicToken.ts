/**
 * Tokens for a PUBLIC form-submission link (`/f/<token>`).
 *
 * The token is the *only* thing standing between a stranger and a form's questions
 * (`forms.publicGet` returns the field list) and its response table, so it has to be
 * unguessable — and, just as importantly, one shared link must not reveal anything about any
 * *other* form's link. Public form links are meant to be handed out, so an attacker always has
 * a valid sample.
 *
 * That rules out `Math.random()`: it's a fast non-cryptographic PRNG, so a few outputs can be
 * enough to recover its internal state and derive other draws from the same stream.
 *
 * `crypto.getRandomValues` is non-deterministic and therefore unavailable in a mutation (a
 * mutation must be replayable) — the same constraint that makes `mcp.createToken` and
 * `bots.create` actions. Hence the two functions below: a mutation mints a throwaway
 * placeholder and immediately schedules `forms.strengthenToken`, an action, to replace it.
 */

/** Random bytes → the URL-safe alphabet used in the link. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * The real thing: 24 cryptographically-random bytes (192 bits). **Actions only** — calling this
 * in a mutation throws.
 */
export function makeStrongPublicToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

/**
 * A placeholder minted inside a mutation, where no secure RNG exists. It is **not** treated as
 * a secret: `seedForm` schedules `forms.strengthenToken` to overwrite it in the same tick, so
 * it exists only for the moment between the insert and that action running, before any link has
 * been shown to anyone. Never reuse this for a value that stays.
 */
export function makeSeedToken(): string {
  let out = 'seed'
  for (let i = 0; i < 5; i += 1) {
    out += Math.floor(Math.random() * 0x100000000)
      .toString(36)
      .padStart(7, '0')
  }
  return out
}

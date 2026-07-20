/**
 * A random token for a PUBLIC form-submission link (`/f/<token>`).
 *
 * Convex **mutations cannot use `crypto.getRandomValues`** (it lives in the action/Node
 * runtime, not the mutation isolate — the same reason `mcp.createToken` is an action), and
 * a `form` channel's token is minted inside `channels.create`, a mutation. So this builds a
 * long token from several `Math.random()` draws (which Convex *does* support in a mutation).
 *
 * That is deliberate and sufficient: this secret only gates *submitting a form*, whose whole
 * point is to be widely shared — it is not a bearer credential to any account or data. It's
 * long enough not to be guessable; a rotate (`forms.regenerateLink`) revokes an old link.
 */
export function makePublicToken(): string {
  let out = ''
  for (let i = 0; i < 5; i += 1) {
    out += Math.floor(Math.random() * 0x100000000)
      .toString(36)
      .padStart(7, '0')
  }
  return out
}

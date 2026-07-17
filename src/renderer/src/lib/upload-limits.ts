/** The per-file upload ceiling — chat attachments AND page media both enforce it client-side,
 *  and `messages.send` re-checks the reported size server-side. R2 has zero egress cost and cheap
 *  storage, so this is about keeping *total* storage bounded (an unbounded video upload is the
 *  real risk), not about bandwidth. Tune here; if you raise it a lot, consider a per-workspace
 *  quota + a chunked/resumable upload instead of a single PUT.
 *
 *  NB: true enforcement can't happen at the R2 PUT (the browser uploads straight to R2, bypassing
 *  Convex), so this is a client gate + a server reported-size check. A crafted client could
 *  under-report, but the honest UI is capped and the file still counts against the rate limit. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export const MAX_UPLOAD_LABEL = '50 MB'

/** True if a file is within the upload ceiling. */
export function withinUploadLimit(size: number): boolean {
  return size <= MAX_UPLOAD_BYTES
}

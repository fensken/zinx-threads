import { defineApp } from 'convex/server'
// Requires `@convex-dev/workos-authkit` to be installed (see SETUP.md). This is
// the maintained Convex WorkOS component (get-convex/workos-authkit): it syncs
// WorkOS users/orgs into Convex via webhooks and backs SCIM de-provisioning.
import workosAuthKit from '@convex-dev/workos-authkit/convex.config'

const app = defineApp()
app.use(workosAuthKit)

export default app

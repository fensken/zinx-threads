// Tells Convex which JWTs to trust: WorkOS AuthKit issues the user's identity
// token, validated against WorkOS' JWKS on every function call.
//
// `WORKOS_CLIENT_ID` is a Convex *deployment* env var. With AuthKit
// auto-provisioning (see convex.json + SETUP.md), the interactive `npx convex dev`
// sets it for you. Convex statically requires any referenced env var to be set,
// so this file only pushes cleanly once that's done.
//
// Reference: https://docs.convex.dev/auth/authkit
const clientId = process.env.WORKOS_CLIENT_ID

export default {
  providers: [
    {
      type: 'customJwt',
      issuer: `https://api.workos.com/user_management/${clientId}`,
      algorithm: 'RS256',
      jwks: `https://api.workos.com/sso/jwks/${clientId}`
    }
  ]
}

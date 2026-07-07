// Tells Convex which JWTs to trust. WorkOS AuthKit issues the user's identity
// token; Convex validates it against WorkOS' JWKS on every function call.
//
// `WORKOS_CLIENT_ID` is a Convex *deployment* env var — set it with
//   npx convex env set WORKOS_CLIENT_ID client_xxx
// (see .env.sample / SETUP.md). Do NOT hardcode it here.
//
// Reference: https://docs.convex.dev/auth/authkit
const clientId = process.env.WORKOS_CLIENT_ID

export default {
  providers: [
    // AuthKit user-management tokens (normal email/social/enterprise sign-in).
    {
      type: 'customJwt',
      issuer: `https://api.workos.com/user_management/${clientId}`,
      algorithm: 'RS256',
      jwks: `https://api.workos.com/sso/jwks/${clientId}`
    },
    // Enterprise SSO tokens.
    {
      type: 'customJwt',
      issuer: 'https://api.workos.com/',
      algorithm: 'RS256',
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      applicationID: clientId
    }
  ]
}

import { Navigate, createFileRoute } from '@tanstack/react-router'

// WorkOS AuthKit redirect target (VITE_WORKOS_REDIRECT_URI = …/callback). The
// AuthKitProvider (above the router) exchanges the `?code` before this renders,
// so by the time we're here the session is set — bounce to `/`, which routes to
// the user's first workspace or to onboarding.
function Callback(): React.JSX.Element {
  return <Navigate to="/" replace />
}

export const Route = createFileRoute('/callback')({
  component: Callback
})

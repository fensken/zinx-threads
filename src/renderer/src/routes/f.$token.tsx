import { createFileRoute } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { LockKey, SignIn } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import { authEnabled } from '@renderer/lib/auth-client'
import { useAppAuth } from '@renderer/lib/use-app-auth'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import { LogoWordmark } from '@renderer/components/layout/logo'
import { FormRenderer } from '@renderer/components/form/form-renderer'

export const Route = createFileRoute('/f/$token')({
  component: PublicFormPage
})

function PublicFormPage(): React.JSX.Element {
  if (!authEnabled) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Forms aren’t available in this build.</p>
      </Shell>
    )
  }
  return <PublicFormInner />
}

function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-dvh w-full justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-xl space-y-6">
        <div className="flex justify-center">
          <LogoWordmark className="opacity-80" />
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">{children}</div>
      </div>
    </div>
  )
}

function PublicFormInner(): React.JSX.Element {
  const { token } = Route.useParams()
  const form = useQuery(api.forms.publicGet, { token })
  const submit = useMutation(api.forms.submit)
  const { signIn } = useAppAuth()

  if (form === undefined) {
    return (
      <Shell>
        <div className="flex justify-center py-6">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      </Shell>
    )
  }
  if (form === null) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Form not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This link is invalid or has been revoked.
        </p>
      </Shell>
    )
  }
  if (form.closed) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">{form.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This form is no longer accepting responses.
        </p>
      </Shell>
    )
  }
  if (form.access === 'need-auth') {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <LockKey className="size-10 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{form.title}</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            You need to be signed in to fill out this form.
          </p>
          <Button onClick={() => void signIn()}>
            <SignIn className="size-4" />
            Sign in
          </Button>
        </div>
      </Shell>
    )
  }
  if (form.access === 'need-member') {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <LockKey className="size-10 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{form.title}</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            This form is only open to members of{' '}
            <span className="font-medium">{form.workspaceName ?? 'this workspace'}</span>.
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <FormRenderer
        title={form.title}
        description={form.description}
        fields={form.fields}
        onSubmit={async (values) => {
          const result = await submit({ token, values })
          return result.confirmationMessage
        }}
      />
    </Shell>
  )
}

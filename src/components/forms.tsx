'use client'
import { useActionState, useEffect, useRef, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

export type ActionResult = { error?: string; ok?: string } | null | undefined | void

export function SubmitButton({ children, className = 'btn-primary', pendingText, confirm, name, value }: {
  children: ReactNode; className?: string; pendingText?: string; confirm?: string; name?: string; value?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault()
      }}
    >
      {pending ? pendingText ?? 'Момент…' : children}
    </button>
  )
}

/** Форма със server action, която показва грешка/успех на място */
export function ActionForm({ action, children, className = '', resetOnOk = false }: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>
  children: ReactNode
  className?: string
  resetOnOk?: boolean
}) {
  const [state, formAction] = useActionState(action, null)
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (resetOnOk && state && 'ok' in state && state.ok) ref.current?.reset()
  }, [state, resetOnOk])
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state && (state.error || state.ok) ? (
        <p role="status" className={`mt-2 text-sm ${state.error ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
          {state.error ?? state.ok}
        </p>
      ) : null}
    </form>
  )
}

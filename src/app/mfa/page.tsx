import { redirect } from 'next/navigation'
import { getMe } from '@/lib/auth'
import { MfaForm } from './mfa-form'

export const metadata = { title: 'Двуфакторна защита' }

export default async function MfaPage() {
  const me = await getMe()
  if (!me) redirect('/login')
  if (me.profile.status !== 'active') redirect('/pending')
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-5">
      <h1 className="text-2xl font-bold">Двуфакторна защита</h1>
      <p className="muted mb-6 mt-2 text-sm">
        Администраторът и ръководството имат достъп до лични данни (включително на деца), затова входът им е защитен с втори фактор –
        приложение като Google Authenticator, Microsoft Authenticator или 1Password.
      </p>
      <MfaForm />
      <form action="/auth/signout" method="post" className="mt-6 text-center">
        <button className="btn-ghost">Изход</button>
      </form>
    </main>
  )
}

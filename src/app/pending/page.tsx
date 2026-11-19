import { redirect } from 'next/navigation'
import { getMe } from '@/lib/auth'

export const metadata = { title: 'Чака одобрение' }

export default async function Pending() {
  const me = await getMe()
  if (!me) redirect('/login')
  if (me.profile.status === 'active') redirect('/')
  const inactive = me.profile.status === 'inactive'
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center p-6 text-center">
      <div className="mb-4 text-5xl">{inactive ? '⏸️' : '⏳'}</div>
      <h1 className="text-2xl font-bold">{inactive ? 'Профилът е неактивен' : 'Чака одобрение'}</h1>
      <p className="muted mt-3">
        {inactive
          ? 'Профилът ви е деактивиран. Свържете се с администратора.'
          : `Здравейте, ${me.profile.first_name || 'приятелю'}! Регистрацията ви е получена. Администраторът ще ви одобри и добави в служенията ви. Ще получите достъп веднага след това.`}
      </p>
      <form action="/auth/signout" method="post" className="mt-8">
        <button className="btn-secondary">Изход</button>
      </form>
    </main>
  )
}

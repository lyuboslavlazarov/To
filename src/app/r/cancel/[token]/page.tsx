import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ActionForm, SubmitButton } from '@/components/forms'
import { fmtDateTime } from '@/lib/format'
import { publicCancel } from '../../actions'

export const metadata = { title: 'Отказ от регистрация', robots: { index: false } }

export default async function CancelPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound()
  const supabase = await createClient()
  const { data: t } = await supabase.rpc('public_ticket', { p_token: token })
  if (!t || t.cancel_token !== token) notFound()
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <div className="card p-6 text-center">
        <h1 className="text-xl font-bold">Отказ от регистрация</h1>
        <p className="mt-2"><b>{t.title}</b>{t.starts_at ? <><br />{fmtDateTime(t.starts_at)}</> : null}</p>
        <p className="muted mt-1 text-sm">{t.first_name} {t.last_name}</p>
        {t.status === 'cancelled' ? <p className="mt-4 text-sm text-slate-500">Регистрацията вече е отказана.</p> : (
          <ActionForm action={publicCancel} className="mt-5">
            <input type="hidden" name="token" value={token} />
            <SubmitButton className="btn-danger w-full" confirm="Сигурни ли сте? Мястото ще бъде дадено на следващия в списъка.">Да, откажи регистрацията</SubmitButton>
          </ActionForm>
        )}
      </div>
    </main>
  )
}

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { qrDataUrl } from '@/lib/registrations'
import { fmtDate, fmtTime } from '@/lib/format'

export const metadata = { title: 'Билет', robots: { index: false } }

export default async function Ticket({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ new?: string }> }) {
  const { token } = await params
  const sp = await searchParams
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound()
  const supabase = await createClient()
  const { data: t } = await supabase.rpc('public_ticket', { p_token: token })
  if (!t || t.qr_token !== token) notFound()
  const qr = t.status === 'confirmed' ? await qrDataUrl(t.qr_token, 480) : null
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      {sp.new && <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-center text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
        {t.status === 'confirmed' ? 'Готово! Изпратихме ви имейл с билета.' : 'Записахме ви в списъка на изчакване. Ще получите имейл, ако се освободи място.'}</p>}
      <div className="card overflow-hidden text-center">
        <div className="bg-brand-600 p-5 text-white">
          <div className="text-sm opacity-80">{t.status === 'confirmed' ? 'Билет' : t.status === 'waitlist' ? 'Списък на изчакване' : 'Отказана регистрация'}</div>
          <h1 className="text-xl font-bold">{t.title}</h1>
          {t.starts_at && <p className="text-sm opacity-90">{fmtDate(t.starts_at, { weekday: 'long' })}, {fmtTime(t.starts_at)}</p>}
          {t.location && <p className="text-sm opacity-90">📍 {t.location}</p>}
        </div>
        <div className="p-6">
          <div className="text-lg font-semibold">{t.first_name} {t.last_name}</div>
          {t.seat_row && <div className="mt-1 text-2xl font-bold text-brand-600">Ред {t.seat_row} · Място {t.seat_number}</div>}
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR код за вход" className="mx-auto mt-4 w-64 rounded-xl bg-white p-2" />
          )}
          {t.status === 'waitlist' && <p className="mt-4 text-sm">Вие сте <b>№ {t.waitlist_position}</b> в списъка на изчакване.</p>}
          {t.status === 'cancelled' && <p className="mt-4 text-sm text-rose-600">Тази регистрация е отказана.</p>}
          {t.status === 'confirmed' && <p className="muted mt-3 text-xs">Покажете кода на входа. Можете да направите снимка на екрана.</p>}
        </div>
      </div>
      {t.status !== 'cancelled' && <p className="mt-4 text-center text-sm"><Link href={`/r/cancel/${t.cancel_token}`} className="text-rose-600 underline">Не мога да дойда – откажи регистрацията</Link></p>}
    </main>
  )
}

import { notFound, redirect } from 'next/navigation'
import { getMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fmtDate, fmtTime } from '@/lib/format'
import { PrintButton } from './print-button'

export const metadata = { title: 'Етикет' }

/** Етикет за детето и талон за родителя – за принтер на етикети или обикновен принтер */
export default async function KidsPrint({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ auto?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const me = await getMe()
  if (!me) redirect('/login')
  const supabase = await createClient()
  const { data: c } = await supabase.from('checkins').select('*, children(id, first_name, last_name), teams(name)').eq('id', id).maybeSingle()
  if (!c) notFound()
  const { data: alert } = await supabase.rpc('child_has_alerts', { p_child: c.children.id })
  return (
    <main className="mx-auto max-w-sm p-4 print:p-0">
      <style>{`@page { size: 62mm auto; margin: 2mm } @media print { .label { break-after: page } }`}</style>
      <div className="label mb-4 rounded-xl border-2 border-black bg-white p-3 text-black">
        <div className="flex items-start justify-between">
          <div className="text-2xl font-black leading-tight">{c.children.first_name}<br /><span className="text-lg font-bold">{c.children.last_name}</span></div>
          <div className="rounded-lg bg-black px-2 py-1 text-xl font-black tracking-widest text-white">{c.security_code}</div>
        </div>
        <div className="mt-1 text-sm font-semibold">{c.teams?.name}</div>
        {alert && <div className="mt-1 rounded bg-black px-2 py-0.5 text-sm font-bold text-white">⚠ ВИЖ БЕЛЕЖКИТЕ / АЛЕРГИИ</div>}
        <div className="mt-1 text-xs">{fmtDate(c.checked_in_at)} · {fmtTime(c.checked_in_at)}</div>
      </div>
      <div className="label rounded-xl border-2 border-dashed border-black bg-white p-3 text-black">
        <div className="text-xs font-semibold uppercase">Талон за родителя</div>
        <div className="mt-1 text-4xl font-black tracking-[.3em]">{c.security_code}</div>
        <div className="text-sm">{c.children.first_name} {c.children.last_name} · {c.teams?.name}</div>
        <div className="mt-1 text-xs">Пазете талона – детето се предава само срещу този код.</div>
      </div>
      <div className="no-print mt-4 flex gap-2"><PrintButton auto={!!sp.auto} /><a href="/kids" className="btn-secondary">← Назад</a></div>
    </main>
  )
}

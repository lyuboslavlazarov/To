import Link from 'next/link'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Badge, Empty } from '@/components/ui'
import { fmtTime, fmtDate, localDay } from '@/lib/format'

export const metadata = { title: 'Общ календар' }
const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд']

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string; view?: string }> }) {
  const me = await requireMe()
  const sp = await searchParams
  const view = sp.view === 'list' ? 'list' : 'month'
  const today = localDay()
  const [y, m] = (sp.m ?? today.slice(0, 7)).split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const last = new Date(Date.UTC(y, m, 0))
  const supabase = await createClient()
  const from = view === 'list' ? new Date().toISOString() : new Date(first.getTime() - 7 * 864e5).toISOString()
  const to = view === 'list' ? new Date(Date.now() + 90 * 864e5).toISOString() : new Date(last.getTime() + 8 * 864e5).toISOString()
  const [{ data: events }, { data: mine }, { data: bookings }] = await Promise.all([
    supabase.from('events').select('id, title, starts_at, ends_at, is_cancelled, color, rooms(name)').gte('starts_at', from).lte('starts_at', to).order('starts_at'),
    supabase.from('assignments').select('event_id, status').eq('profile_id', me.id).neq('status', 'declined'),
    supabase.from('room_bookings').select('id, title, starts_at, ends_at, rooms(name)').is('event_id', null).gte('starts_at', from).lte('starts_at', to).order('starts_at'),
  ])
  const myEvents = new Set((mine ?? []).map((a) => a.event_id))
  const items = [
    ...(events ?? []).map((e: any) => ({ ...e, kind: 'event' as const })),
    ...(bookings ?? []).map((b: any) => ({ ...b, kind: 'booking' as const })),
  ].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const byDay = new Map<string, any[]>()
  for (const e of items) {
    const d = localDay(e.starts_at)
    byDay.set(d, [...(byDay.get(d) ?? []), e])
  }
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7)
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)
  const startOffset = (first.getUTCDay() + 6) % 7
  const days: (string | null)[] = [...Array(startOffset).fill(null), ...Array.from({ length: last.getUTCDate() }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)]
  while (days.length % 7) days.push(null)
  const monthName = new Intl.DateTimeFormat('bg-BG', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)

  return (
    <>
      <PageHeader title="Общ календар" subtitle="Всички виждат събитията; графиците и подробностите са само за съответните служения."
        actions={<div className="flex gap-1">
          <Link href={`?view=month&m=${sp.m ?? ''}`} className={`btn-sm ${view === 'month' ? 'btn-primary' : 'btn-secondary'}`}>Месец</Link>
          <Link href="?view=list" className={`btn-sm ${view === 'list' ? 'btn-primary' : 'btn-secondary'}`}>Списък</Link>
        </div>} />
      {view === 'month' ? (
        <Card className="p-2 sm:p-4">
          <div className="mb-3 flex items-center justify-between">
            <Link href={`?m=${prev}`} className="btn-ghost btn-sm">←</Link>
            <h2 className="font-semibold capitalize">{monthName}</h2>
            <Link href={`?m=${next}`} className="btn-ghost btn-sm">→</Link>
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl bg-slate-200 text-xs dark:bg-slate-800">
            {WD.map((d) => <div key={d} className="bg-slate-50 p-1 text-center font-semibold uppercase text-slate-500 dark:bg-slate-900">{d}</div>)}
            {days.map((d, i) => (
              <div key={i} className={`min-h-16 bg-white p-1 sm:min-h-24 dark:bg-slate-950 ${d === today ? 'ring-2 ring-inset ring-brand-500' : ''}`}>
                {d && <div className={`mb-0.5 text-right ${d === today ? 'font-bold text-brand-600' : 'muted'}`}>{Number(d.slice(8))}</div>}
                {d && (byDay.get(d) ?? []).map((e) => e.kind === 'event' ? (
                  <Link key={e.id} href={`/events/${e.id}`} title={e.title}
                    className={`mb-0.5 block truncate rounded px-1 py-0.5 ${myEvents.has(e.id) ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' : 'bg-brand-50 text-brand-700 dark:bg-brand-700/30 dark:text-brand-200'} ${e.is_cancelled ? 'line-through opacity-50' : ''}`}>
                    <span className="hidden sm:inline">{fmtTime(e.starts_at)} </span>{e.title}
                  </Link>
                ) : (
                  <div key={e.id} title={`${e.title} (${e.rooms?.name})`} className="mb-0.5 truncate rounded bg-slate-100 px-1 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <span className="hidden sm:inline">{fmtTime(e.starts_at)} </span>{e.title}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="muted mt-2 text-xs"><span className="inline-block h-2 w-2 rounded bg-emerald-400" /> служите · <span className="inline-block h-2 w-2 rounded bg-brand-300" /> събитие · <span className="inline-block h-2 w-2 rounded bg-slate-300" /> резервация на помещение</p>
        </Card>
      ) : !items.length ? <Empty>Няма предстоящи събития.</Empty> : (
        <div className="space-y-4">
          {[...byDay.entries()].map(([d, list]) => (
            <div key={d}>
              <h3 className="mb-1 text-sm font-semibold capitalize text-brand-600">{fmtDate(d + 'T12:00:00Z', { weekday: 'long' })}</h3>
              <Card className="p-0">
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {list.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="muted w-24 shrink-0">{fmtTime(e.starts_at)}–{fmtTime(e.ends_at)}</span>
                      {e.kind === 'event' ? <Link href={`/events/${e.id}`} className={`flex-1 font-medium hover:underline ${e.is_cancelled ? 'line-through opacity-60' : ''}`}>{e.title}</Link>
                        : <span className="flex-1">{e.title}</span>}
                      <span className="muted hidden text-xs sm:inline">{e.rooms?.name}</span>
                      {myEvents.has(e.id) && <Badge color="green">служите</Badge>}
                      {e.kind === 'booking' && <Badge>резервация</Badge>}
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

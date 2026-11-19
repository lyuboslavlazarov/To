import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Badge, Empty } from '@/components/ui'
import { fmtShortDate, fmtTime } from '@/lib/format'

export const metadata = { title: 'Събития и планове' }

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ past?: string }> }) {
  const me = await requireMe()
  if (!me.isStaff && !me.isLeader && !me.can('events')) redirect('/calendar')
  const sp = await searchParams
  const supabase = await createClient()
  const now = new Date().toISOString()
  let q = supabase.from('events').select('id, title, starts_at, ends_at, is_cancelled, series_id, rooms(name)').limit(100)
  q = sp.past ? q.lt('starts_at', now).order('starts_at', { ascending: false }) : q.gte('ends_at', now).order('starts_at')
  const [{ data: events }, { data: open }] = await Promise.all([
    q,
    supabase.from('v_unfilled_needs').select('event_id, open_slots, pending, team_id').gte('starts_at', now),
  ])
  const stats = new Map<string, { open: number; pending: number }>()
  for (const u of (open ?? []) as any[]) {
    if (!me.isStaff && !me.ledTeamIds.includes(u.team_id)) continue
    const s = stats.get(u.event_id) ?? { open: 0, pending: 0 }
    s.open += u.open_slots; s.pending += u.pending
    stats.set(u.event_id, s)
  }
  return (
    <>
      <PageHeader title="Събития и планове" subtitle="Всяко събитие е план: програма, нужни хора по позиции, файлове и бележки."
        actions={me.can('events') && <>
          <Link href="/events/series" className="btn-secondary">Повтарящи се</Link>
          <Link href="/events/new" className="btn-primary">+ Ново събитие</Link>
        </>} />
      <div className="mb-3 flex gap-2 text-sm">
        <Link href="/events" className={!sp.past ? 'font-semibold text-brand-600' : 'muted'}>Предстоящи</Link>
        <Link href="/events?past=1" className={sp.past ? 'font-semibold text-brand-600' : 'muted'}>Минали</Link>
      </div>
      {!events?.length ? <Empty>Няма събития.</Empty> : (
        <Card className="p-0">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {events.map((e: any) => {
              const s = stats.get(e.id)
              return (
                <li key={e.id}>
                  <Link href={`/events/${e.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <div className="w-20 shrink-0 text-center">
                      <div className="text-xs font-semibold uppercase text-brand-600">{fmtShortDate(e.starts_at)}</div>
                      <div className="muted text-xs">{fmtTime(e.starts_at)}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`font-medium ${e.is_cancelled ? 'line-through opacity-60' : ''}`}>{e.title}</div>
                      <div className="muted text-xs">{e.rooms?.name ?? ''}{e.series_id ? ' · повтарящо се' : ''}</div>
                    </div>
                    {e.is_cancelled && <Badge color="red">Отменено</Badge>}
                    {s && s.open > 0 && <Badge color="yellow">{s.open} незаети</Badge>}
                    {s && s.open === 0 && <Badge color="green">попълнено</Badge>}
                  </Link>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </>
  )
}

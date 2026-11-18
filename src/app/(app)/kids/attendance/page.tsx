import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Badge, statusColor } from '@/components/ui'
import { fmtShortDate, fmtTime, localDay, STATUS_LABEL } from '@/lib/format'
import { KidsTabs } from '../kids-tabs'

export default async function Attendance({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const me = await requireMe()
  if (!me.isKidsStaff) redirect('/')
  const sp = await searchParams
  const day = sp.day ?? localDay()
  const supabase = await createClient()
  const since = new Date(Date.now() - 12 * 7 * 864e5).toISOString()
  const [{ data: groups }, { data: checks }, { data: teachers }] = await Promise.all([
    supabase.from('teams').select('id, name, departments!inner(slug)').eq('departments.slug', 'kids').order('sort'),
    supabase.from('checkins').select('id, checked_in_at, checked_out_at, group_team_id, children(first_name, last_name)').gte('checked_in_at', since).order('checked_in_at', { ascending: false }),
    supabase.from('assignments').select('id, status, team_id, positions(name), profile:profiles!assignments_profile_id_fkey(first_name, last_name), events!inner(id, title, starts_at)')
      .gte('events.starts_at', new Date().toISOString()).lte('events.starts_at', new Date(Date.now() + 21 * 864e5).toISOString()),
  ])
  const kidGroups = (groups ?? [])
  const kidTeamIds = new Set(kidGroups.map((g) => g.id))
  const weeks: string[] = []
  for (let i = 11; i >= 0; i--) weeks.push(localDay(new Date(Date.now() - i * 7 * 864e5)))
  const weekKey = (d: string) => { const dt = new Date(d); const day = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - day); return dt.toISOString().slice(0, 10) }
  const wk = [...new Set(weeks.map(weekKey))]
  const count = (gid: string, w: string) => (checks ?? []).filter((c) => c.group_team_id === gid && weekKey(c.checked_in_at) === w).length
  const todays = (checks ?? []).filter((c) => localDay(c.checked_in_at) === day)
  const sched = (teachers ?? []).filter((a: any) => kidTeamIds.has(a.team_id)).sort((a: any, b: any) => a.events.starts_at.localeCompare(b.events.starts_at))

  return (
    <>
      <PageHeader title="Детско служение" />
      <KidsTabs active="attendance" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Присъствие по групи (последните 12 седмици)" className="lg:col-span-2 overflow-x-auto">
          <table className="table">
            <thead><tr><th>Група</th>{wk.map((w) => <th key={w} className="text-center">{fmtShortDate(w + 'T12:00:00Z').split(',')[1] ?? w.slice(5)}</th>)}</tr></thead>
            <tbody>
              {kidGroups.map((g) => (
                <tr key={g.id}><td className="whitespace-nowrap font-medium">{g.name}</td>
                  {wk.map((w) => { const n = count(g.id, w); return <td key={w} className="text-center"><span className={n ? 'font-semibold' : 'muted'}>{n || '·'}</span></td> })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Списък за деня" actions={<form className="flex gap-1"><input type="date" name="day" defaultValue={day} className="input py-1" /><button className="btn-secondary btn-sm">OK</button></form>}>
          {kidGroups.map((g) => {
            const list = todays.filter((c) => c.group_team_id === g.id)
            if (!list.length) return null
            return (
              <div key={g.id} className="mb-3">
                <div className="text-sm font-semibold text-brand-600">{g.name} ({list.length})</div>
                <ul className="text-sm">{list.map((c: any) => <li key={c.id} className="flex justify-between"><span>{c.children?.first_name} {c.children?.last_name}</span><span className="muted text-xs">{fmtTime(c.checked_in_at)}–{c.checked_out_at ? fmtTime(c.checked_out_at) : '…'}</span></li>)}</ul>
              </div>
            )
          })}
          {!todays.length && <p className="muted text-sm">Няма присъствия за тази дата.</p>}
        </Card>
        <Card title="График на учителите (3 седмици)">
          {!sched.length ? <p className="muted text-sm">Няма разпределени учители. Разпределете ги от страницата на всяка група.</p> : (
            <ul className="space-y-1.5 text-sm">
              {sched.map((a: any) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <span className="muted w-24 text-xs">{fmtShortDate(a.events.starts_at)}</span>
                  <span className="flex-1">{fullName(a.profile)} <span className="muted text-xs">– {kidGroups.find((g) => g.id === a.team_id)?.name}, {a.positions?.name}</span></span>
                  <Badge color={statusColor(a.status)}>{STATUS_LABEL[a.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-1">{kidGroups.map((g) => <Link key={g.id} href={`/teams/${g.id}/matrix`} className="btn-ghost btn-sm">{g.name} →</Link>)}</div>
        </Card>
      </div>
    </>
  )
}

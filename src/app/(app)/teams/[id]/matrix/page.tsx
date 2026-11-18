import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { loadTeam } from '@/lib/team'
import { PageHeader, Empty } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { LiveRefresh } from '@/components/live-refresh'
import { fmtShortDate, fmtTime } from '@/lib/format'
import { TeamTabs } from '../team-tabs'
import { assignPerson, removeAssignment, autofillMany } from '../../../events/actions'

const CELL: Record<string, string> = {
  confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  declined: 'bg-rose-100 text-rose-700 line-through dark:bg-rose-900/40 dark:text-rose-300',
}

export default async function MatrixPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ weeks?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const weeks = Number(sp.weeks ?? 8)
  const me = await requireMe()
  const supabase = await createClient()
  const { team, canManage } = await loadTeam(supabase, me, id)
  if (!canManage) notFound()
  const now = new Date()
  const until = new Date(now.getTime() + weeks * 7 * 864e5).toISOString()
  const [{ data: events }, { data: needs }, { data: assigns }] = await Promise.all([
    supabase.from('events').select('id, title, starts_at, is_cancelled').gte('starts_at', now.toISOString()).lte('starts_at', until).eq('is_cancelled', false).order('starts_at'),
    supabase.from('plan_needs').select('event_id, position_id, needed').eq('team_id', id),
    supabase.from('assignments').select('id, event_id, position_id, profile_id, status, profile:profiles!assignments_profile_id_fkey(first_name, last_name)').eq('team_id', id),
  ])
  const evs = (events ?? []).filter((e) => (needs ?? []).some((n) => n.event_id === e.id) || (assigns ?? []).some((a) => a.event_id === e.id))
  const cands = new Map<string, any[]>()
  await Promise.all(evs.map(async (e) => {
    const { data } = await supabase.rpc('event_team_candidates', { p_event: e.id, p_team: id })
    cands.set(e.id, data ?? [])
  }))

  return (
    <>
      <LiveRefresh table="assignments" filter={`team_id=eq.${id}`} channel={`mx-${id}`} />
      <PageHeader back={`/teams/${id}`} title={team.name} subtitle="Матричен изглед: събития × позиции" />
      <TeamTabs id={id} active="matrix" canManage={canManage} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[4, 8, 12].map((w) => <Link key={w} href={`?weeks=${w}`} className={`btn-sm ${w === weeks ? 'btn-primary' : 'btn-secondary'}`}>{w} седмици</Link>)}
        <ActionForm action={autofillMany} className="ml-auto">
          <input type="hidden" name="team_id" value={id} />
          {evs.map((e) => <input key={e.id} type="hidden" name="event_ids" value={e.id} />)}
          <SubmitButton className="btn-primary btn-sm" pendingText="Попълване…" confirm="Да попълня ли автоматично всички незаети места от свободните хора?">⚡ Попълни всички незаети</SubmitButton>
        </ActionForm>
      </div>
      {!evs.length ? <Empty>Няма събития с нужди за екипа в този период. Добавете нужди от страницата на събитието или от повтарящите се събития.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white p-2 text-left dark:bg-slate-900">Събитие</th>
                {team.positions.map((p: any) => <th key={p.id} className="min-w-[150px] border-l border-slate-100 p-2 text-left dark:border-slate-800">{p.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {evs.map((e) => {
                const c = cands.get(e.id) ?? []
                const assignedHere = new Set((assigns ?? []).filter((a) => a.event_id === e.id && a.status !== 'declined').map((a) => a.profile_id))
                return (
                  <tr key={e.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                    <td className="sticky left-0 z-10 bg-white p-2 dark:bg-slate-900">
                      <Link href={`/events/${e.id}?team=${id}`} className="font-medium hover:underline">{fmtShortDate(e.starts_at)} {fmtTime(e.starts_at)}</Link>
                      <div className="muted max-w-[140px] truncate">{e.title}</div>
                    </td>
                    {team.positions.map((p: any) => {
                      const need = (needs ?? []).find((n) => n.event_id === e.id && n.position_id === p.id)
                      const rows = (assigns ?? []).filter((a) => a.event_id === e.id && a.position_id === p.id)
                      const open = Math.max((need?.needed ?? 0) - rows.filter((r) => r.status !== 'declined').length, 0)
                      return (
                        <td key={p.id} className={`border-l border-slate-100 p-1.5 dark:border-slate-800 ${!need && !rows.length ? 'bg-slate-50 dark:bg-slate-950/40' : ''}`}>
                          <div className="space-y-1">
                            {rows.map((r: any) => (
                              <ActionForm key={r.id} action={removeAssignment}>
                                <input type="hidden" name="id" value={r.id} /><input type="hidden" name="event_id" value={e.id} />
                                <button className={`w-full truncate rounded-md px-1.5 py-0.5 text-left ${CELL[r.status]}`} title="Натиснете, за да премахнете">{fullName(r.profile)}</button>
                              </ActionForm>
                            ))}
                            {open > 0 && (
                              <ActionForm action={assignPerson}>
                                <input type="hidden" name="event_id" value={e.id} /><input type="hidden" name="position_id" value={p.id} />
                                <div className="flex gap-1">
                                  <select name="profile_id" className="w-full rounded-md border border-dashed border-amber-400 bg-transparent px-1 py-0.5 text-xs" defaultValue="">
                                    <option value="">+ ({open})</option>
                                    {c.filter((x) => !assignedHere.has(x.profile_id)).sort((a, b) => Number(b.available) - Number(a.available)).map((x) => {
                                      const bad = x.cannot || x.blocked || !!x.busy
                                      return <option key={x.profile_id} value={x.profile_id} disabled={bad}>{x.available ? '✓ ' : bad ? '⛔ ' : ''}{fullName(x)}</option>
                                    })}
                                  </select>
                                  <SubmitButton className="rounded-md bg-brand-600 px-1.5 text-white" pendingText="…">+</SubmitButton>
                                </div>
                              </ActionForm>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted mt-2 text-xs">Зелено – потвърдено · жълто – чака · червено – отказано · ✓ свободен · ⛔ не може/зает. Натиснете име, за да го премахнете.</p>
    </>
  )
}

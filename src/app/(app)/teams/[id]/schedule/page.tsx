import Link from 'next/link'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { loadTeam } from '@/lib/team'
import { PageHeader, Card, Badge, Empty, statusColor } from '@/components/ui'
import { fmtShortDate, fmtTime, STATUS_LABEL } from '@/lib/format'
import { TeamTabs } from '../team-tabs'

export default async function TeamSchedule({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await requireMe()
  const supabase = await createClient()
  const { team, canManage } = await loadTeam(supabase, me, id)
  const now = new Date().toISOString()
  const [{ data: needs }, { data: assigns }] = await Promise.all([
    supabase.from('plan_needs').select('event_id, position_id, needed, events!inner(id, title, starts_at, is_cancelled)').eq('team_id', id).gte('events.starts_at', now),
    supabase.from('assignments').select('id, event_id, position_id, status, profile_id, profile:profiles!assignments_profile_id_fkey(first_name, last_name), events!inner(id, title, starts_at, is_cancelled)').eq('team_id', id).gte('events.starts_at', now),
  ])
  const evs = new Map<string, any>()
  for (const r of [...(needs ?? []), ...(assigns ?? [])] as any[]) evs.set(r.events.id, r.events)
  const list = [...evs.values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  return (
    <>
      <PageHeader back={`/teams/${id}`} title={team.name} subtitle="График на екипа" />
      <TeamTabs id={id} active="schedule" canManage={canManage} />
      {!list.length ? <Empty>Няма предстоящи събития с нужди за екипа.</Empty> : (
        <div className="space-y-3">
          {list.map((e) => (
            <Card key={e.id}>
              <div className="mb-2 flex items-center gap-2">
                <div className="text-xs"><span className="font-semibold text-brand-600">{fmtShortDate(e.starts_at)}</span> <span className="muted">{fmtTime(e.starts_at)}</span></div>
                <Link href={`/events/${e.id}?team=${id}`} className={`font-medium hover:underline ${e.is_cancelled ? 'line-through' : ''}`}>{e.title}</Link>
                {canManage && <Link href={`/events/${e.id}?team=${id}`} className="btn-ghost btn-sm ml-auto">Разпредели →</Link>}
              </div>
              <div className="grid gap-1 text-sm sm:grid-cols-2">
                {team.positions.map((p: any) => {
                  const need = (needs ?? []).find((n: any) => n.event_id === e.id && n.position_id === p.id)
                  const rows = (assigns ?? []).filter((a: any) => a.event_id === e.id && a.position_id === p.id && a.status !== 'declined')
                  if (!need && !rows.length) return null
                  const open = Math.max((need?.needed ?? 0) - rows.length, 0)
                  return (
                    <div key={p.id} className="flex flex-wrap items-center gap-1">
                      <span className="muted w-full text-xs sm:w-auto">{p.name}:</span>
                      {rows.map((r: any) => <Badge key={r.id} color={statusColor(r.status)}>{fullName(r.profile)}{r.profile_id === me.id ? ' (вие)' : ''}</Badge>)}
                      {open > 0 && <Badge color="yellow">незаети {open}</Badge>}
                    </div>
                  )
                })}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

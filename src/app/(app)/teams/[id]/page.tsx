import Link from 'next/link'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { loadTeam } from '@/lib/team'
import { PageHeader, Card, Avatar, Badge, Empty, statusColor } from '@/components/ui'
import { fmtDateTime, STATUS_LABEL } from '@/lib/format'
import { TeamTabs } from './team-tabs'

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await requireMe()
  const supabase = await createClient()
  const { team, canManage } = await loadTeam(supabase, me, id)
  const now = new Date().toISOString()
  const [{ data: members }, { data: upcoming }, { data: anns }] = await Promise.all([
    supabase.from('team_members').select('is_leader, profiles(id, first_name, last_name, avatar_url, phone)').eq('team_id', id),
    supabase.from('assignments').select('id, status, profile_id, events!inner(id, title, starts_at), positions(name), profiles!assignments_profile_id_fkey(first_name, last_name)')
      .eq('team_id', id).gte('events.starts_at', now).order('created_at').limit(60),
    supabase.from('announcements').select('id, title, body, created_at, author_name').eq('audience', 'team').eq('audience_id', id).order('created_at', { ascending: false }).limit(3),
  ])
  const byEvent = new Map<string, { ev: any; rows: any[] }>()
  for (const a of (upcoming ?? []) as any[]) {
    const k = a.events.id
    if (!byEvent.has(k)) byEvent.set(k, { ev: a.events, rows: [] })
    byEvent.get(k)!.rows.push(a)
  }
  const events = [...byEvent.values()].sort((a, b) => a.ev.starts_at.localeCompare(b.ev.starts_at)).slice(0, 5)
  const sortedMembers = (members ?? []).sort((a: any, b: any) => Number(b.is_leader) - Number(a.is_leader) || fullName(a.profiles).localeCompare(fullName(b.profiles)))

  return (
    <>
      <PageHeader back="/teams" title={team.name} subtitle={<span style={{ color: team.departments?.color }}>{team.departments?.name}</span>} />
      <TeamTabs id={id} active="overview" canManage={canManage} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Предстоящ график" actions={<Link href={`/teams/${id}/schedule`} className="text-sm text-brand-600">Всичко →</Link>}>
            {!events.length ? <Empty>Няма разпределени хора за предстоящите събития.</Empty> : (
              <div className="space-y-3">
                {events.map(({ ev, rows }) => (
                  <div key={ev.id}>
                    <Link href={`/events/${ev.id}?team=${id}`} className="font-medium hover:underline">{ev.title}</Link>
                    <span className="muted ml-2 text-xs">{fmtDateTime(ev.starts_at)}</span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {rows.map((r) => (
                        <Badge key={r.id} color={statusColor(r.status)}>{r.positions?.name}: {fullName(r.profiles)}{r.status !== 'confirmed' ? ` (${STATUS_LABEL[r.status]})` : ''}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          {!!anns?.length && (
            <Card title="Съобщения до екипа">
              <ul className="space-y-3">
                {anns.map((a) => (
                  <li key={a.id}><div className="font-medium">{a.title}</div><p className="muted line-clamp-2 text-sm">{a.body}</p><div className="muted text-xs">{a.author_name} · {fmtDateTime(a.created_at)}</div></li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card title={`Членове (${members?.length ?? 0})`} actions={canManage && <Link href={`/teams/${id}/members`} className="text-sm text-brand-600">Управлявай</Link>}>
            <ul className="space-y-2">
              {sortedMembers.map((m: any) => (
                <li key={m.profiles.id} className="flex items-center gap-2 text-sm">
                  <Avatar p={m.profiles} size={30} />
                  <Link href={canManage ? `/people/${m.profiles.id}` : '#'} className="flex-1 truncate">{fullName(m.profiles)}</Link>
                  {m.is_leader && <Badge color="blue">Лидер</Badge>}
                  {m.profiles.phone && <a href={`tel:${m.profiles.phone}`} className="muted text-xs">📞</a>}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Позиции">
            <ul className="space-y-1 text-sm">{team.positions.map((p: any) => <li key={p.id} className="flex justify-between"><span>{p.name}</span><span className="muted">×{p.default_count}</span></li>)}</ul>
          </Card>
        </div>
      </div>
    </>
  )
}

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Stat, Badge, Avatar } from '@/components/ui'
import { fmtDate, fmtDateTime, fmtShortDate } from '@/lib/format'

export const metadata = { title: 'Отчети' }

function Bars({ data, keys }: { data: any[]; keys: { k: string; label: string; color: string }[] }) {
  const max = Math.max(1, ...data.flatMap((d) => keys.map((k) => Number(d[k.k]) || 0)))
  return (
    <div>
      <div className="flex h-40 items-end gap-1">
        {data.map((d) => (
          <div key={d.week} className="flex flex-1 items-end justify-center gap-px" title={`${fmtShortDate(d.week + 'T12:00:00Z')}: ${keys.map((k) => `${k.label} ${d[k.k]}`).join(', ')}`}>
            {keys.map((k) => <div key={k.k} className="w-full max-w-3 rounded-t" style={{ height: `${(Number(d[k.k]) / max) * 100}%`, minHeight: Number(d[k.k]) ? 2 : 0, background: k.color }} />)}
          </div>
        ))}
      </div>
      <div className="muted mt-1 flex justify-between text-[10px]"><span>{data[0] && fmtShortDate(data[0].week + 'T12:00:00Z')}</span><span>тази седмица</span></div>
      <div className="mt-2 flex gap-3 text-xs">{keys.map((k) => <span key={k.k} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded" style={{ background: k.color }} />{k.label}</span>)}</div>
    </div>
  )
}

export default async function ReportsPage() {
  const me = await requireMe()
  if (!me.isStaff && !me.isLeader) redirect('/')
  const supabase = await createClient()
  const now = new Date().toISOString()
  const since90 = new Date(Date.now() - 90 * 864e5).toISOString()
  const myTeams = me.isStaff ? null : me.ledTeamIds
  let aq = supabase.from('assignments').select('profile_id, team_id, status, profile:profiles!assignments_profile_id_fkey(id, first_name, last_name, avatar_url), events!inner(starts_at)').gte('events.starts_at', since90).lte('events.starts_at', now)
  let tmq = supabase.from('team_members').select('team_id, profile:profiles(id, first_name, last_name, avatar_url, status), teams(name)')
  if (myTeams) { aq = aq.in('team_id', myTeams); tmq = tmq.in('team_id', myTeams) }
  const [summary, { data: attendance }, { data: unfilled }, { data: served }, { data: members }, { data: bdays }, { data: regEvents }] = await Promise.all([
    me.isStaff ? supabase.rpc('report_summary') : Promise.resolve({ data: null }),
    supabase.rpc('report_attendance', { p_weeks: 12 }),
    supabase.from('v_unfilled_needs').select('*').gt('open_slots', 0).gte('starts_at', now).order('starts_at').limit(40),
    aq, tmq,
    supabase.rpc('upcoming_birthdays', { p_days: 30 }),
    me.can('registrations') ? supabase.from('reg_events').select('id, title, capacity, starts_at, registrations(status, checked_in_at)').order('starts_at', { ascending: false }).limit(8) : Promise.resolve({ data: null }),
  ])
  const s: any = summary?.data
  // активност на доброволците
  const count = new Map<string, number>()
  for (const a of (served ?? []) as any[]) if (a.status === 'confirmed') count.set(a.profile_id, (count.get(a.profile_id) ?? 0) + 1)
  const people = new Map<string, any>()
  for (const m of (members ?? []) as any[]) if (m.profile?.status === 'active') people.set(m.profile.id, m.profile)
  const inactive = [...people.values()].filter((p) => !count.has(p.id))
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, n]) => ({ p: people.get(id) ?? (served as any[]).find((x) => x.profile_id === id)?.profile, n }))
  const declines = (served ?? []).filter((a: any) => a.status === 'declined').length
  const totalInv = (served ?? []).length

  return (
    <>
      <PageHeader title="Табла и отчети" subtitle={me.isStaff ? 'Цялата организация' : 'Само вашите екипи'} />
      {s && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Активни хора" value={s.active_people} />
          <Stat label="Служили (90 дни)" value={s.active_volunteers_90d} />
          <Stat label="Незаети места (14 дни)" value={s.open_slots_14d} tone={s.open_slots_14d ? 'warn' : 'ok'} />
          <Stat label="Отворени сигнали" value={s.open_issues} tone={s.open_issues ? 'warn' : 'default'} href="/tasks?view=issues" />
        </div>
      )}
      {!s && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Хора в екипите ми" value={people.size} />
          <Stat label="Служили (90 дни)" value={count.size} />
          <Stat label="Без служене (90 дни)" value={inactive.length} tone={inactive.length ? 'warn' : 'ok'} />
          <Stat label="Откази" value={totalInv ? `${Math.round((declines / totalInv) * 100)}%` : '—'} />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Присъствие (12 седмици)">
          <Bars data={(attendance ?? []) as any[]} keys={[
            { k: 'volunteers', label: 'Служили', color: '#6366f1' },
            ...(me.isKidsStaff ? [{ k: 'kids', label: 'Деца', color: '#10b981' }] : []),
            ...(me.can('registrations') ? [{ k: 'registrations', label: 'Влезли (регистрации)', color: '#f59e0b' }] : []),
          ]} />
        </Card>
        <Card title="Незаети позиции">
          {!unfilled?.length ? <p className="text-sm text-emerald-600">Всичко е попълнено 🎉</p> : (
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto text-sm dark:divide-slate-800">
              {(unfilled as any[]).map((u) => (
                <li key={u.id} className="flex items-center gap-2 py-1.5">
                  <span className="muted w-28 shrink-0 text-xs">{fmtDateTime(u.starts_at)}</span>
                  <Link href={`/events/${u.event_id}?team=${u.team_id}`} className="flex-1 truncate hover:underline">{u.team_name} – {u.position_name}</Link>
                  <Badge color="yellow">{u.open_slots}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Най-активни (90 дни)">
          <ul className="space-y-1.5 text-sm">
            {top.map(({ p, n }) => p && (
              <li key={p.id} className="flex items-center gap-2"><Avatar p={p} size={24} /><Link href={`/people/${p.id}`} className="flex-1">{fullName(p)}</Link><span className="font-semibold">{n}×</span></li>
            ))}
            {!top.length && <li className="muted">Няма данни.</li>}
          </ul>
        </Card>
        <Card title={`Без служене последните 90 дни (${inactive.length})`}>
          <p className="muted mb-2 text-xs">Добър повод за едно обаждане 🙂</p>
          <div className="flex max-h-60 flex-wrap gap-1.5 overflow-y-auto">
            {inactive.map((p) => <Link key={p.id} href={`/people/${p.id}`}><Badge>{fullName(p)}</Badge></Link>)}
          </div>
        </Card>
        <Card title="🎂 Рождени дни (30 дни)">
          <ul className="space-y-1.5 text-sm">
            {((bdays ?? []) as any[]).map((b) => <li key={b.id} className="flex justify-between"><Link href={`/people/${b.id}`}>{fullName(b)}</Link><span className="muted text-xs">{fmtDate(b.next_date, { year: undefined })} · {b.turns} г.</span></li>)}
            {!bdays?.length && <li className="muted">Няма.</li>}
          </ul>
        </Card>
        {regEvents && (
          <Card title="Регистрации">
            <ul className="space-y-2 text-sm">
              {(regEvents as any[]).map((e) => {
                const c = e.registrations.filter((r: any) => r.status === 'confirmed').length
                const w = e.registrations.filter((r: any) => r.status === 'waitlist').length
                const i = e.registrations.filter((r: any) => r.checked_in_at).length
                return (
                  <li key={e.id}>
                    <Link href={`/registrations/${e.id}`} className="font-medium hover:underline">{e.title}</Link>
                    <div className="muted text-xs">{c}/{e.capacity} записани · {w} чакат · {i} влезли</div>
                  </li>
                )
              })}
            </ul>
          </Card>
        )}
      </div>
    </>
  )
}

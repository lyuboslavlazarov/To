import Link from 'next/link'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Badge, Empty, Stat, Avatar, Flash, statusColor } from '@/components/ui'
import { fmtDateTime, fmtDate, STATUS_LABEL } from '@/lib/format'

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const me = await requireMe()
  const sp = await searchParams
  const supabase = await createClient()
  const now = new Date().toISOString()
  const showBirthdays = me.isStaff || me.isLeader

  const [{ data: mine }, { data: bdays }, summary, { data: unfilled }, { data: anns }, { data: myTasks }] = await Promise.all([
    supabase.from('assignments').select('id, status, events!inner(id, title, starts_at), positions(name), teams(name)')
      .eq('profile_id', me.id).neq('status', 'declined').gte('events.starts_at', now).limit(20),
    showBirthdays ? supabase.rpc('upcoming_birthdays', { p_days: 14 }) : Promise.resolve({ data: null }),
    me.isStaff ? supabase.rpc('report_summary') : Promise.resolve({ data: null }),
    me.isStaff || me.isLeader
      ? supabase.from('v_unfilled_needs').select('*').gt('open_slots', 0).gte('starts_at', now).lte('starts_at', new Date(Date.now() + 14 * 864e5).toISOString()).order('starts_at').limit(12)
      : Promise.resolve({ data: null }),
    supabase.from('announcements').select('id, title, body, created_at, author_name, pinned').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(3),
    supabase.from('tasks').select('id, title, due_at, is_issue').eq('assignee_id', me.id).neq('status', 'done').order('due_at').limit(5),
  ])
  const upcoming = (mine ?? []).sort((a: any, b: any) => a.events.starts_at.localeCompare(b.events.starts_at))
  const s: any = summary?.data

  return (
    <>
      <Flash error={sp.error} />
      <PageHeader title={`Здравейте, ${me.profile.first_name || 'приятелю'}!`} subtitle={fmtDate(new Date(), { weekday: 'long' })} />

      {s && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Незаети места (14 дни)" value={s.open_slots_14d} tone={s.open_slots_14d > 0 ? 'warn' : 'ok'} href="/reports" />
          <Stat label="Активни доброволци (90 дни)" value={s.active_volunteers_90d} href="/reports" />
          <Stat label="Чакащи отговор" value={s.pending_invites} />
          {me.isAdmin ? <Stat label="Чакат одобрение" value={s.pending_people} tone={s.pending_people ? 'warn' : 'default'} href="/admin" />
            : <Stat label="Деца тази седмица" value={s.kids_this_week} />}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Моите предстоящи служения" actions={<Link href="/my" className="text-sm text-brand-600">Моят календар →</Link>}>
            {!upcoming.length ? <Empty>Нямате предстоящи служения. Отбележете в <Link className="text-brand-600 underline" href="/my">Моят календар</Link> кога сте свободни.</Empty> : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {upcoming.slice(0, 6).map((a: any) => (
                  <li key={a.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link href={`/events/${a.events.id}`} className="font-medium hover:underline">{a.events.title}</Link>
                      <div className="muted text-xs">{fmtDateTime(a.events.starts_at)} · {a.teams?.name} · {a.positions?.name}</div>
                    </div>
                    <Badge color={statusColor(a.status)}>{STATUS_LABEL[a.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {unfilled && (
            <Card title="Незаети позиции (следващите 2 седмици)">
              {!unfilled.length ? <p className="text-sm text-emerald-600">Всички позиции са попълнени 🎉</p> : (
                <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                  {unfilled.map((u: any) => (
                    <li key={u.id} className="flex items-center gap-2 py-2">
                      <span className="muted w-28 shrink-0 text-xs">{fmtDateTime(u.starts_at)}</span>
                      <Link href={`/events/${u.event_id}?team=${u.team_id}`} className="min-w-0 flex-1 truncate hover:underline">{u.event_title}</Link>
                      <span className="muted hidden sm:inline">{u.team_name} · {u.position_name}</span>
                      <Badge color="yellow">липсват {u.open_slots}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {bdays && (
            <Card title="🎂 Рождени дни (14 дни)">
              {!bdays.length ? <p className="muted text-sm">Няма предстоящи.</p> : (
                <ul className="space-y-2">
                  {(bdays as any[]).map((b: any) => (
                    <li key={b.id} className="flex items-center gap-2 text-sm">
                      <Avatar p={b} size={28} />
                      <Link href={`/people/${b.id}`} className="flex-1 truncate">{fullName(b)}</Link>
                      <span className="muted text-xs">{fmtDate(b.next_date, { year: undefined })} · {b.turns} г.</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {!!myTasks?.length && (
            <Card title="Моите задачи" actions={<Link href="/tasks" className="text-sm text-brand-600">Всички →</Link>}>
              <ul className="space-y-1.5 text-sm">
                {myTasks.map((t) => <li key={t.id}><Link href={`/tasks/${t.id}`} className="hover:underline">{t.is_issue ? '🔧 ' : '• '}{t.title}</Link> {t.due_at && <span className="muted text-xs">до {fmtDateTime(t.due_at)}</span>}</li>)}
              </ul>
            </Card>
          )}
          <Card title="Съобщения" actions={<Link href="/messages" className="text-sm text-brand-600">Всички →</Link>}>
            {!anns?.length ? <p className="muted text-sm">Няма съобщения.</p> : (
              <ul className="space-y-3">
                {anns.map((a) => (
                  <li key={a.id}>
                    <div className="font-medium">{a.pinned && '📌 '}{a.title}</div>
                    <p className="muted line-clamp-2 text-sm">{a.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}

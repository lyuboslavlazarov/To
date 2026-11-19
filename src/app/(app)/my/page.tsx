import Link from 'next/link'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Badge, Empty, Field, statusColor } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { AvailabilityRow } from '@/components/availability-row'
import { LiveRefresh } from '@/components/live-refresh'
import { fmtDate, fmtShortDate, fmtTime, fmtDateTime, STATUS_LABEL, localDay } from '@/lib/format'
import { respond, addBlockout, deleteBlockout, selfSignup } from '../events/actions'

export const metadata = { title: 'Моят календар' }

export default async function MyPage() {
  const me = await requireMe()
  const supabase = await createClient()
  const now = new Date()
  const until = new Date(now.getTime() + 70 * 864e5).toISOString()
  const myTeams = me.memberships.map((m) => ({ id: m.team_id, name: m.team.name }))

  const [{ data: events }, { data: avail }, { data: assigns }, { data: needs }, { data: blockouts }, { data: open }] = await Promise.all([
    supabase.from('events').select('id, title, starts_at, ends_at, is_cancelled, rooms(name)').gte('ends_at', now.toISOString()).lte('starts_at', until).order('starts_at'),
    supabase.from('availability').select('event_id, team_id, status').eq('profile_id', me.id),
    supabase.from('assignments').select('id, event_id, status, team_id, decline_reason, positions(name), teams(name), events!inner(id, title, starts_at, ends_at, rooms(name))')
      .eq('profile_id', me.id).gte('events.ends_at', now.toISOString()),
    myTeams.length ? supabase.from('plan_needs').select('event_id, team_id').in('team_id', myTeams.map((t) => t.id)) : Promise.resolve({ data: [] }),
    supabase.from('blockouts').select('*').eq('profile_id', me.id).gte('ends_on', localDay()).order('starts_on'),
    supabase.rpc('open_slots_for_me'),
  ])

  const all = (assigns ?? []).sort((a: any, b: any) => a.events.starts_at.localeCompare(b.events.starts_at))
  const pending = all.filter((a) => a.status === 'pending')
  const confirmed = all.filter((a) => a.status === 'confirmed')
  const blockedDay = (d: string) => (blockouts ?? []).some((b) => b.starts_on <= d && b.ends_on >= d)

  return (
    <>
      <LiveRefresh table="assignments" filter={`profile_id=eq.${me.id}`} channel={`my-${me.id}`} />
      <PageHeader title="Моят календар" subtitle="Приемете поканите и отбележете за всяко събитие в кое от служенията си можете да се включите." />

      {pending.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 font-semibold">Чакат вашия отговор ({pending.length})</h2>
          <div className="space-y-3">
            {pending.map((a: any) => (
              <div key={a.id} className="card border-l-4 border-l-amber-500 p-4">
                <Link href={`/events/${a.events.id}`} className="font-semibold">{a.events.title}</Link>
                <div className="muted text-sm">{fmtDate(a.events.starts_at, { weekday: 'long', year: undefined })}, {fmtTime(a.events.starts_at)}{a.events.rooms ? ` · ${a.events.rooms.name}` : ''}</div>
                <div className="mt-1 text-sm"><b>{a.teams?.name}</b> – {a.positions?.name}</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <ActionForm action={respond}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="confirmed" /><SubmitButton className="btn-success w-full">✓ Приемам</SubmitButton></ActionForm>
                  <details className="group">
                    <summary className="btn-secondary w-full list-none">✕ Не мога</summary>
                    <ActionForm action={respond} className="mt-2 space-y-2">
                      <input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="declined" />
                      <input name="reason" placeholder="Причина (по избор)" className="input" />
                      <SubmitButton className="btn-danger w-full">Откажи</SubmitButton>
                    </ActionForm>
                  </details>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Потвърдени служения">
            {!confirmed.length ? <p className="muted text-sm">Няма потвърдени предстоящи служения.</p> : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {confirmed.map((a: any) => (
                  <li key={a.id} className="flex items-center gap-3 py-2.5">
                    <div className="w-20 shrink-0 text-xs"><div className="font-semibold text-brand-600">{fmtShortDate(a.events.starts_at)}</div><div className="muted">{fmtTime(a.events.starts_at)}</div></div>
                    <div className="min-w-0 flex-1"><Link href={`/events/${a.events.id}`} className="font-medium hover:underline">{a.events.title}</Link><div className="muted text-xs">{a.teams?.name} – {a.positions?.name}</div></div>
                    <details className="text-right">
                      <summary className="cursor-pointer list-none text-xs text-slate-500">Откажи</summary>
                      <ActionForm action={respond} className="mt-1 flex gap-1"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="declined" />
                        <input name="reason" placeholder="Причина" className="input w-28 py-1" /><SubmitButton className="btn-danger btn-sm" confirm="Да откажа ли? Лидерът ще бъде уведомен.">OK</SubmitButton></ActionForm>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Кога мога да служа">
            {!myTeams.length ? <Empty>Още не сте в служение.</Empty> : !events?.length ? <Empty>Няма предстоящи събития.</Empty> : (
              <>
                <p className="muted mb-3 text-xs">Натиснете служението, в което можете да се включите. С пунктир са служенията, за които още не се търсят хора.</p>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {events.filter((e) => !e.is_cancelled).map((e: any) => {
                    const myA = all.filter((a: any) => a.event_id === e.id && a.status !== 'declined')
                    const day = localDay(e.starts_at)
                    const blocked = blockedDay(day)
                    const teams = myTeams.map((t) => ({ ...t, needed: (needs ?? []).some((n) => n.event_id === e.id && n.team_id === t.id) }))
                    return (
                      <li key={e.id} className="py-3">
                        <div className="mb-1.5 flex items-start gap-3">
                          <div className="w-20 shrink-0 text-xs"><div className="font-semibold text-brand-600">{fmtShortDate(e.starts_at)}</div><div className="muted">{fmtTime(e.starts_at)}</div></div>
                          <div className="min-w-0 flex-1">
                            <Link href={`/events/${e.id}`} className="text-sm font-medium hover:underline">{e.title}</Link>
                            {myA.map((a: any) => <Badge key={a.id} color={statusColor(a.status)}>{a.positions?.name}: {STATUS_LABEL[a.status]}</Badge>)}
                            {blocked && <Badge color="red">отсъствие</Badge>}
                          </div>
                        </div>
                        <div className="pl-[92px]">
                          <AvailabilityRow eventId={e.id} teams={teams} locked={blocked}
                            initial={(avail ?? []).filter((v) => v.event_id === e.id && v.team_id).map((v) => v.team_id!)}
                            cannot={(avail ?? []).some((v) => v.event_id === e.id && !v.team_id)} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {!!open?.length && (
            <Card title="Свободни места – запиши се">
              <ul className="space-y-2 text-sm">
                {(open as any[]).slice(0, 15).map((o) => (
                  <li key={o.event_id + o.position_id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1"><div className="truncate font-medium">{o.title}</div><div className="muted text-xs">{fmtDateTime(o.starts_at)} · {o.team_name} – {o.position_name} ({o.open_slots})</div></div>
                    <ActionForm action={selfSignup}><input type="hidden" name="event_id" value={o.event_id} /><input type="hidden" name="position_id" value={o.position_id} /><SubmitButton className="btn-primary btn-sm">Запиши ме</SubmitButton></ActionForm>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Отсъствия">
            <p className="muted mb-3 text-xs">В тези дни няма да получавате покани – лидерите ще виждат, че отсъствате.</p>
            <ActionForm action={addBlockout} className="space-y-2" resetOnOk>
              <div className="grid grid-cols-2 gap-2">
                <Field label="От"><input name="starts_on" type="date" required className="input" min={localDay()} /></Field>
                <Field label="До"><input name="ends_on" type="date" className="input" min={localDay()} /></Field>
              </div>
              <input name="reason" placeholder="Причина (по избор): почивка, командировка…" className="input" />
              <SubmitButton className="btn-secondary btn-sm">+ Добави отсъствие</SubmitButton>
            </ActionForm>
            <ul className="mt-3 space-y-1.5 text-sm">
              {(blockouts ?? []).map((b) => (
                <li key={b.id} className="flex items-center gap-2">
                  <span className="flex-1">{fmtDate(b.starts_on, { year: undefined })}{b.ends_on !== b.starts_on ? ` – ${fmtDate(b.ends_on, { year: undefined })}` : ''}{b.reason ? <span className="muted"> · {b.reason}</span> : ''}</span>
                  <ActionForm action={deleteBlockout}><input type="hidden" name="id" value={b.id} /><SubmitButton className="btn-ghost btn-sm">✕</SubmitButton></ActionForm>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Синхронизация">
            <p className="muted text-xs">Абонирайте се за графика си в Google/Apple календар:</p>
            <Link href="/api/ical" className="mt-2 inline-block text-sm text-brand-600 underline">Изтегли .ics файл</Link>
          </Card>
        </div>
      </div>
    </>
  )
}

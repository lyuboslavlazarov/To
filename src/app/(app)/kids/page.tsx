import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Badge, Empty } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { LiveRefresh } from '@/components/live-refresh'
import { ageFrom, fmtTime, localDay } from '@/lib/format'
import { KidsTabs } from './kids-tabs'
import { checkIn, checkOut } from './actions'

export const metadata = { title: 'Детско служение' }

export default async function KidsCheckin({ searchParams }: { searchParams: Promise<{ q?: string; event?: string }> }) {
  const me = await requireMe()
  if (!me.isKidsStaff) redirect('/')
  const sp = await searchParams
  const supabase = await createClient()
  const today = localDay()
  const dayStart = new Date(Date.now() - 14 * 3600e3).toISOString()
  const [{ data: groups }, { data: events }, { data: inside }] = await Promise.all([
    supabase.from('teams').select('id, name, min_age, departments!inner(slug)').eq('departments.slug', 'kids').not('min_age', 'is', null).order('min_age'),
    supabase.from('events').select('id, title, starts_at').gte('starts_at', today + 'T00:00:00Z').lte('starts_at', today + 'T23:59:59Z').order('starts_at'),
    supabase.from('checkins').select('id, checked_in_at, group_team_id, children(id, first_name, last_name, birthdate)').is('checked_out_at', null).gte('checked_in_at', dayStart).order('checked_in_at'),
  ])

  let results: any[] = []
  const term = sp.q?.replace(/[,()*%\\]/g, ' ').trim()
  if (term) {
    const [{ data: byName }, { data: byGuardian }] = await Promise.all([
      supabase.from('children').select('id, first_name, last_name, birthdate, group_team_id, is_active').eq('is_active', true)
        .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`).limit(30),
      supabase.from('guardians').select('child_guardians(children(id, first_name, last_name, birthdate, group_team_id, is_active))')
        .or(`phone.ilike.%${term}%,last_name.ilike.%${term}%,first_name.ilike.%${term}%`).limit(20),
    ])
    const map = new Map<string, any>()
    for (const c of byName ?? []) map.set(c.id, c)
    for (const g of (byGuardian ?? []) as any[]) for (const cg of g.child_guardians ?? []) if (cg.children?.is_active) map.set(cg.children.id, cg.children)
    results = [...map.values()]
  }
  const alerts = new Map<string, boolean>()
  await Promise.all(results.map(async (c) => {
    const { data } = await supabase.rpc('child_has_alerts', { p_child: c.id })
    alerts.set(c.id, !!data)
  }))
  const insideIds = new Set((inside ?? []).map((i: any) => i.children?.id))
  const groupName = (id: string | null) => (groups ?? []).find((g) => g.id === id)?.name ?? 'Без група'
  const eventId = sp.event ?? events?.[0]?.id ?? ''

  return (
    <>
      <LiveRefresh table="checkins" channel="kids-checkins" />
      <PageHeader title="Детско служение" subtitle="Регистриране при пристигане и сигурно взимане с код" actions={<Link href="/kids/children/new" className="btn-primary">+ Ново дете</Link>} />
      <KidsTabs active="checkin" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Пристигане">
          <form className="mb-3 space-y-2">
            <div className="flex gap-2">
              <input name="q" defaultValue={sp.q} autoFocus placeholder="Име на детето или телефон на родителя" className="input" />
              <button className="btn-primary">Търси</button>
            </div>
            {!!events?.length && (
              <select name="event" defaultValue={eventId} className="input">
                {events.map((e) => <option key={e.id} value={e.id}>{fmtTime(e.starts_at)} {e.title}</option>)}
                <option value="">Без събитие</option>
              </select>
            )}
          </form>
          {term && !results.length && <Empty>Няма намерени деца. <Link href="/kids/children/new" className="text-brand-600 underline">Добавете ново дете</Link>.</Empty>}
          <ul className="space-y-2">
            {results.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div className="min-w-0 flex-1">
                  <Link href={`/kids/children/${c.id}`} className="font-semibold hover:underline">{c.first_name} {c.last_name}</Link>
                  {alerts.get(c.id) && <Badge color="red">⚠ алергии/бележки</Badge>}
                  <div className="muted text-xs">{ageFrom(c.birthdate) != null ? `${ageFrom(c.birthdate)} г. · ` : ''}{groupName(c.group_team_id)}</div>
                </div>
                {insideIds.has(c.id) ? <Badge color="green">вътре е</Badge> : (
                  <ActionForm action={checkIn} className="flex items-center gap-2">
                    <input type="hidden" name="child_id" value={c.id} />
                    <input type="hidden" name="event_id" value={eventId} />
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="print" defaultChecked />етикет</label>
                    <SubmitButton className="btn-success">Регистрирай</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card title={`Вътре в момента (${inside?.length ?? 0})`}>
          {!inside?.length ? <Empty>Няма регистрирани деца.</Empty> : (
            <div className="space-y-4">
              {[...new Set((inside ?? []).map((i: any) => i.group_team_id))].map((gid) => (
                <div key={gid ?? 'none'}>
                  <h3 className="mb-1 text-sm font-semibold text-brand-600">{groupName(gid)}</h3>
                  <ul className="space-y-2">
                    {(inside ?? []).filter((i: any) => i.group_team_id === gid).map((i: any) => (
                      <li key={i.id} className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/50">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="flex-1 font-medium">{i.children?.first_name} {i.children?.last_name}</span>
                          <span className="muted text-xs">от {fmtTime(i.checked_in_at)}</span>
                          <Link href={`/kids-print/${i.id}`} className="btn-ghost btn-sm" target="_blank">🖨</Link>
                        </div>
                        <ActionForm action={checkOut} className="mt-1.5 flex gap-1.5">
                          <input type="hidden" name="checkin_id" value={i.id} />
                          <input name="code" required placeholder="Код от родителя" autoComplete="off" className="input w-36 py-1.5 uppercase tracking-widest" maxLength={4} />
                          <input name="picked_up_by" placeholder="Кой го взима" className="input py-1.5" />
                          <SubmitButton className="btn-secondary btn-sm">Предай</SubmitButton>
                        </ActionForm>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <p className="muted mt-3 text-xs">Детето се предава само срещу кода от родителския талон.</p>
        </Card>
      </div>
    </>
  )
}

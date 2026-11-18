import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Badge, Empty, Avatar, statusColor } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { EventForm } from '@/components/event-form'
import { LiveRefresh } from '@/components/live-refresh'
import { PlanFileUpload } from '@/components/file-upload'
import { fmtDate, fmtTime, fmtDateTime, STATUS_LABEL } from '@/lib/format'
import {
  addPlanItem, movePlanItem, deletePlanRow, addPlanNote, setNeed, assignPerson, removeAssignment, resendInvite,
  autofillAction, respond, cancelEvent, deleteEvent,
} from '../actions'

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ team?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const me = await requireMe()
  const supabase = await createClient()
  const { data: ev } = await supabase.from('events').select('*, rooms(name), event_series(title)').eq('id', id).maybeSingle()
  if (!ev) notFound()

  const [{ data: needs }, { data: assigns }, { data: items }, { data: notes }, { data: files }, { data: rooms }, { data: allTeams }] = await Promise.all([
    supabase.from('plan_needs').select('id, position_id, team_id, needed, positions(name, sort), teams(name, departments(color, sort), sort)').eq('event_id', id),
    supabase.from('assignments').select('id, position_id, team_id, profile_id, status, decline_reason, responded_at, profile:profiles!assignments_profile_id_fkey(first_name, last_name, avatar_url)').eq('event_id', id),
    supabase.from('plan_items').select('*, teams(name)').eq('event_id', id).order('sort').order('created_at'),
    supabase.from('plan_notes').select('*, teams(name), author:profiles(first_name, last_name)').eq('event_id', id).order('created_at'),
    supabase.from('plan_files').select('*, teams(name)').eq('event_id', id).order('created_at'),
    me.can('events') ? supabase.from('rooms').select('id, name').order('sort') : Promise.resolve({ data: [] }),
    supabase.from('teams').select('id, name, department_id, sort, positions(id, name, sort), departments(sort, color)'),
  ])

  const canEditEvent = me.can('events')
  const manages = (teamId: string) => me.isStaff || me.ledTeamIds.includes(teamId) || (allTeams ?? []).some((t: any) => t.id === teamId && me.ledDepartmentIds.includes(t.department_id))
  // екипите, които виждам в плана: с нужди, с разпределени, или които управлявам
  const teamIds = new Set<string>([...(needs ?? []).map((n) => n.team_id), ...(assigns ?? []).map((a) => a.team_id)])
  for (const t of allTeams ?? []) if (manages(t.id) && !me.isStaff) teamIds.add(t.id)
  const teams = (allTeams ?? []).filter((t: any) => teamIds.has(t.id))
    .sort((a: any, b: any) => (a.departments?.sort ?? 0) - (b.departments?.sort ?? 0) || a.sort - b.sort)
  if (sp.team) teams.sort((a: any, b: any) => Number(b.id === sp.team) - Number(a.id === sp.team))

  const managedTeams = teams.filter((t: any) => manages(t.id))
  const cands = new Map<string, any[]>()
  await Promise.all(managedTeams.map(async (t: any) => {
    const { data } = await supabase.rpc('event_team_candidates', { p_event: id, p_team: t.id })
    cands.set(t.id, data ?? [])
  }))
  const signed = files?.length ? (await supabase.storage.from('plan-files').createSignedUrls(files.map((f) => f.storage_path), 3600)).data ?? [] : []
  const urlFor = (path: string) => signed.find((s) => s.path === path)?.signedUrl
  const mine = (assigns ?? []).filter((a) => a.profile_id === me.id)
  const past = new Date(ev.ends_at) < new Date()

  return (
    <>
      <LiveRefresh table="assignments" filter={`event_id=eq.${id}`} channel={`ev-${id}`} />
      <PageHeader back="/events" title={<span className={ev.is_cancelled ? 'line-through opacity-60' : ''}>{ev.title}</span>}
        subtitle={<>{fmtDate(ev.starts_at, { weekday: 'long' })}, {fmtTime(ev.starts_at)}–{fmtTime(ev.ends_at)}{ev.rooms ? ` · ${ev.rooms.name}` : ''}{ev.event_series ? ' · повтарящо се' : ''}</>}
        actions={<>{ev.is_cancelled && <Badge color="red">Отменено</Badge>}</>} />

      {mine.map((a) => (
        <div key={a.id} className={`card mb-4 border-l-4 p-4 ${a.status === 'pending' ? 'border-l-amber-500' : a.status === 'confirmed' ? 'border-l-emerald-500' : 'border-l-rose-500'}`}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1">
              <div className="font-semibold">Вие служите: {teams.find((t: any) => t.id === a.team_id)?.name} – {teams.find((t: any) => t.id === a.team_id)?.positions.find((p: any) => p.id === a.position_id)?.name}</div>
              <div className="muted text-sm">Статус: {STATUS_LABEL[a.status]}</div>
            </div>
            {!past && a.status !== 'confirmed' && <ActionForm action={respond}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="confirmed" /><SubmitButton className="btn-success">✓ Приемам</SubmitButton></ActionForm>}
            {!past && a.status !== 'declined' && (
              <ActionForm action={respond} className="flex gap-2"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="declined" />
                <input name="reason" placeholder="Причина (по избор)" className="input w-40" /><SubmitButton className="btn-secondary">✕ Не мога</SubmitButton></ActionForm>
            )}
          </div>
        </div>
      ))}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <h2 className="text-lg font-semibold">Екипи и позиции</h2>
          {!teams.length && <Empty>Няма нужни позиции за вашите екипи в това събитие.</Empty>}
          {teams.map((t: any) => {
            const canManage = manages(t.id)
            const tNeeds = (needs ?? []).filter((n) => n.team_id === t.id).sort((a: any, b: any) => (a.positions?.sort ?? 0) - (b.positions?.sort ?? 0))
            const tAssigns = (assigns ?? []).filter((a) => a.team_id === t.id)
            const positionIds = [...new Set([...tNeeds.map((n) => n.position_id), ...tAssigns.map((a) => a.position_id)])]
            const posList = t.positions.filter((p: any) => positionIds.includes(p.id)).sort((a: any, b: any) => a.sort - b.sort)
            const missing = t.positions.filter((p: any) => !positionIds.includes(p.id))
            const c = cands.get(t.id) ?? []
            const filled = tAssigns.filter((a) => a.status !== 'declined').length
            const total = tNeeds.reduce((s, n) => s + n.needed, 0)
            if (!canManage && !posList.length) return null
            return (
              <Card key={t.id} className={sp.team === t.id ? 'ring-2 ring-brand-500' : ''}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.departments?.color }} />
                  <Link href={`/teams/${t.id}`} className="font-semibold hover:underline">{t.name}</Link>
                  <Badge color={filled >= total && total > 0 ? 'green' : 'yellow'}>{filled}/{total}</Badge>
                  {canManage && !past && (
                    <ActionForm action={autofillAction} className="ml-auto">
                      <input type="hidden" name="event_id" value={id} /><input type="hidden" name="team_id" value={t.id} />
                      <SubmitButton className="btn-secondary btn-sm" pendingText="Попълване…">⚡ Автоматично попълване</SubmitButton>
                    </ActionForm>
                  )}
                </div>
                <div className="space-y-4">
                  {posList.map((p: any) => {
                    const need = tNeeds.find((n) => n.position_id === p.id)
                    const rows = tAssigns.filter((a) => a.position_id === p.id).sort((a, b) => a.status.localeCompare(b.status))
                    const active = rows.filter((r) => r.status !== 'declined').length
                    const open = Math.max((need?.needed ?? 0) - active, 0)
                    const assigned = new Set(tAssigns.filter((a) => a.status !== 'declined').map((a) => a.profile_id))
                    const options = c.filter((x) => !assigned.has(x.profile_id))
                      .map((x) => ({ ...x, q: !x.position_ids?.length || x.position_ids.includes(p.id), bad: x.cannot || x.blocked || !!x.busy }))
                      .sort((a, b) => Number(b.available) - Number(a.available) || Number(a.bad) - Number(b.bad) || Number(b.q) - Number(a.q) || (a.last_served ?? '').localeCompare(b.last_served ?? ''))
                    return (
                      <div key={p.id}>
                        <div className="mb-1.5 flex items-center gap-2 text-sm">
                          <span className="font-medium">{p.name}</span>
                          {open > 0 ? <Badge color="yellow">незаети {open}</Badge> : need ? <Badge color="green">✓</Badge> : null}
                          {canManage && !past && (
                            <ActionForm action={setNeed} className="ml-auto flex items-center gap-1">
                              <input type="hidden" name="event_id" value={id} /><input type="hidden" name="position_id" value={p.id} />
                              <span className="muted text-xs">нужни</span>
                              <input name="needed" type="number" min={0} max={50} defaultValue={need?.needed ?? 0} className="input w-16 py-1" />
                              <SubmitButton className="btn-ghost btn-sm">OK</SubmitButton>
                            </ActionForm>
                          )}
                        </div>
                        <ul className="space-y-1">
                          {rows.map((r: any) => (
                            <li key={r.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-2 py-1.5 text-sm dark:bg-slate-800/50">
                              <Avatar p={r.profile} size={26} />
                              <span className={`flex-1 truncate ${r.status === 'declined' ? 'line-through opacity-60' : ''}`}>{fullName(r.profile)}</span>
                              {r.decline_reason && <span className="muted hidden truncate text-xs sm:inline">„{r.decline_reason}“</span>}
                              <Badge color={statusColor(r.status)}>{STATUS_LABEL[r.status]}</Badge>
                              {canManage && !past && r.status === 'declined' && (
                                <ActionForm action={resendInvite}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="event_id" value={id} /><SubmitButton className="btn-ghost btn-sm" pendingText="…">↻</SubmitButton></ActionForm>
                              )}
                              {canManage && (
                                <ActionForm action={removeAssignment}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="event_id" value={id} /><SubmitButton className="btn-ghost btn-sm" pendingText="…">✕</SubmitButton></ActionForm>
                              )}
                            </li>
                          ))}
                        </ul>
                        {canManage && !past && (
                          <ActionForm action={assignPerson} className="mt-1.5 flex gap-2">
                            <input type="hidden" name="event_id" value={id} /><input type="hidden" name="position_id" value={p.id} />
                            <select name="profile_id" className="input py-1.5" defaultValue="">
                              <option value="">+ Покани човек…</option>
                              {options.map((o) => (
                                <option key={o.profile_id} value={o.profile_id} disabled={o.bad}>
                                  {o.available ? '✓ ' : o.bad ? '⛔ ' : '· '}{fullName(o)}
                                  {o.cannot ? ' – не може' : o.blocked ? ' – отсъства' : o.busy ? ` – зает: ${o.busy}` : ''}
                                  {!o.bad ? (o.last_served ? ` (последно: ${new Date(o.last_served).toLocaleDateString('bg-BG')})` : ' (не е служил)') : ''}
                                  {!o.q && !o.bad ? ' [друга позиция]' : ''}
                                </option>
                              ))}
                            </select>
                            <SubmitButton className="btn-primary btn-sm">Покани</SubmitButton>
                          </ActionForm>
                        )}
                      </div>
                    )
                  })}
                  {canManage && !past && missing.length > 0 && (
                    <ActionForm action={setNeed} className="flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                      <input type="hidden" name="event_id" value={id} />
                      <select name="position_id" className="input py-1.5">{missing.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                      <input name="needed" type="number" min={1} defaultValue={1} className="input w-16 py-1.5" />
                      <SubmitButton className="btn-secondary btn-sm">+ Позиция</SubmitButton>
                    </ActionForm>
                  )}
                </div>
                {canManage && <p className="muted mt-3 text-xs">✓ отбелязал(а) се е като свободен · ⛔ не може/зает (защита от конфликти) · · без отговор</p>}
              </Card>
            )
          })}
          {(canEditEvent || me.isStaff) && !past && (
            <Card title="Добави нужда от екип">
              <ActionForm action={setNeed} className="flex flex-wrap gap-2">
                <input type="hidden" name="event_id" value={id} />
                <select name="position_id" className="input flex-1" required>
                  {(allTeams ?? []).sort((a: any, b: any) => (a.departments?.sort ?? 0) - (b.departments?.sort ?? 0) || a.sort - b.sort).map((t: any) => (
                    <optgroup key={t.id} label={t.name}>
                      {(t.positions ?? []).sort((a: any, b: any) => a.sort - b.sort).map((p: any) => <option key={p.id} value={p.id}>{t.name} – {p.name}</option>)}
                    </optgroup>
                  ))}
                </select>
                <input name="needed" type="number" min={1} defaultValue={1} className="input w-20" />
                <SubmitButton className="btn-secondary">Добави</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card title="Програма">
            {!items?.length && <p className="muted mb-2 text-sm">Няма програма.</p>}
            <ol className="space-y-1.5">
              {(items ?? []).map((it: any, i: number) => {
                const canEdit = it.team_id ? manages(it.team_id) : canEditEvent
                return (
                  <li key={it.id} className="flex items-start gap-2 text-sm">
                    <span className="muted w-5 shrink-0 text-right">{i + 1}.</span>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{it.title}</span>
                      {it.duration_minutes && <span className="muted"> · {it.duration_minutes} мин.</span>}
                      {it.teams && <Badge>{it.teams.name}</Badge>}
                      {it.notes && <p className="muted text-xs">{it.notes}</p>}
                    </div>
                    {canEdit && (
                      <span className="flex shrink-0">
                        <ActionForm action={movePlanItem}><input type="hidden" name="event_id" value={id} /><input type="hidden" name="id" value={it.id} /><input type="hidden" name="dir" value="-1" /><SubmitButton className="btn-ghost btn-sm px-1.5" pendingText="↑">↑</SubmitButton></ActionForm>
                        <ActionForm action={movePlanItem}><input type="hidden" name="event_id" value={id} /><input type="hidden" name="id" value={it.id} /><input type="hidden" name="dir" value="1" /><SubmitButton className="btn-ghost btn-sm px-1.5" pendingText="↓">↓</SubmitButton></ActionForm>
                        <ActionForm action={deletePlanRow}><input type="hidden" name="table" value="plan_items" /><input type="hidden" name="event_id" value={id} /><input type="hidden" name="id" value={it.id} /><SubmitButton className="btn-ghost btn-sm px-1.5" pendingText="…">✕</SubmitButton></ActionForm>
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
            {(canEditEvent || managedTeams.length > 0) && (
              <ActionForm action={addPlanItem} className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800" resetOnOk>
                <input type="hidden" name="event_id" value={id} />
                <div className="flex gap-2">
                  <input name="title" placeholder="Точка от програмата" required className="input" />
                  <input name="duration_minutes" type="number" placeholder="мин." className="input w-20" />
                </div>
                <div className="flex gap-2">
                  <select name="team_id" className="input">
                    {canEditEvent && <option value="">Обща (вижда се от всички)</option>}
                    {managedTeams.map((t: any) => <option key={t.id} value={t.id}>Само за {t.name}</option>)}
                  </select>
                  <SubmitButton className="btn-secondary btn-sm">Добави</SubmitButton>
                </div>
              </ActionForm>
            )}
          </Card>

          <Card title="Бележки">
            {!notes?.length && <p className="muted text-sm">Няма бележки.</p>}
            <ul className="space-y-2">
              {(notes ?? []).map((n: any) => (
                <li key={n.id} className="rounded-xl bg-slate-50 p-2.5 text-sm dark:bg-slate-800/50">
                  <p className="whitespace-pre-line">{n.body}</p>
                  <div className="muted mt-1 flex items-center gap-2 text-xs">
                    {n.teams && <Badge>{n.teams.name}</Badge>}{fullName(n.author)} · {fmtDateTime(n.created_at)}
                    {(n.team_id ? manages(n.team_id) : canEditEvent) && (
                      <ActionForm action={deletePlanRow} className="ml-auto"><input type="hidden" name="table" value="plan_notes" /><input type="hidden" name="event_id" value={id} /><input type="hidden" name="id" value={n.id} /><SubmitButton className="btn-ghost btn-sm" pendingText="…">✕</SubmitButton></ActionForm>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {(canEditEvent || managedTeams.length > 0) && (
              <ActionForm action={addPlanNote} className="mt-3 space-y-2" resetOnOk>
                <input type="hidden" name="event_id" value={id} />
                <textarea name="body" rows={2} required className="input" placeholder="Бележка…" />
                <div className="flex gap-2">
                  <select name="team_id" className="input">
                    {canEditEvent && <option value="">За всички</option>}
                    {managedTeams.map((t: any) => <option key={t.id} value={t.id}>Само за {t.name}</option>)}
                  </select>
                  <SubmitButton className="btn-secondary btn-sm">Добави</SubmitButton>
                </div>
              </ActionForm>
            )}
          </Card>

          <Card title="Файлове" actions={<div className="flex gap-1">
            {canEditEvent && <PlanFileUpload eventId={id} teamId={null} />}
            {!canEditEvent && managedTeams[0] && <PlanFileUpload eventId={id} teamId={managedTeams[0].id} />}
          </div>}>
            {!files?.length ? <p className="muted text-sm">Няма файлове.</p> : (
              <ul className="space-y-1.5 text-sm">
                {files.map((f: any) => (
                  <li key={f.id} className="flex items-center gap-2">
                    <a href={urlFor(f.storage_path) ?? undefined} target="_blank" className="flex-1 truncate text-brand-600 hover:underline">📎 {f.name}</a>
                    {f.teams && <Badge>{f.teams.name}</Badge>}
                    {(f.team_id ? manages(f.team_id) : canEditEvent) && (
                      <ActionForm action={deletePlanRow}><input type="hidden" name="table" value="plan_files" /><input type="hidden" name="event_id" value={id} /><input type="hidden" name="id" value={f.id} /><SubmitButton className="btn-ghost btn-sm" pendingText="…">✕</SubmitButton></ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {ev.description && <Card title="Описание"><p className="whitespace-pre-line text-sm">{ev.description}</p></Card>}

          {canEditEvent && (
            <Card title="Управление на събитието">
              <details><summary className="cursor-pointer text-sm text-brand-600">Редактирай</summary><div className="mt-3"><EventForm ev={ev} rooms={rooms ?? []} /></div></details>
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionForm action={cancelEvent}><input type="hidden" name="id" value={id} /><input type="hidden" name="cancel" value={ev.is_cancelled ? 'false' : 'true'} />
                  <SubmitButton className="btn-secondary btn-sm" confirm={ev.is_cancelled ? undefined : 'Да отменя ли събитието? Разпределените хора ще бъдат уведомени.'}>{ev.is_cancelled ? 'Възстанови' : 'Отмени събитието'}</SubmitButton></ActionForm>
                <ActionForm action={deleteEvent}><input type="hidden" name="id" value={id} />
                  <SubmitButton className="btn-ghost btn-sm text-rose-600" confirm="Да изтрия ли събитието окончателно (заедно с графика)?">Изтрий</SubmitButton></ActionForm>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dbError, str, num, type Result } from '@/lib/actions'
import { fromLocalInput, fmtDateTime } from '@/lib/format'
import { notify, sendPush, teamLeaderIds } from '@/lib/notify'

const rev = (eventId?: string | null) => {
  if (eventId) revalidatePath(`/events/${eventId}`)
  revalidatePath('/my')
  revalidatePath('/teams', 'layout')
}

// ---------------- Събития ----------------
export async function saveEvent(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const id = str(fd, 'id')
  const starts_at = fromLocalInput(str(fd, 'starts_at'))
  const ends_at = fromLocalInput(str(fd, 'ends_at'))
  if (!str(fd, 'title') || !starts_at || !ends_at) return { error: 'Попълнете заглавие, начало и край' }
  if (ends_at <= starts_at) return { error: 'Краят трябва да е след началото' }
  const row = { title: str(fd, 'title'), description: str(fd, 'description'), starts_at, ends_at, room_id: str(fd, 'room_id'), visibility: str(fd, 'visibility') ?? 'all' }
  if (id) {
    const { error } = await supabase.from('events').update(row).eq('id', id)
    if (error) return { error: dbError(error) }
    rev(id)
    return { ok: 'Запазено' }
  }
  const { data, error } = await supabase.from('events').insert({ ...row, created_by: me.id }).select('id').single()
  if (error) return { error: dbError(error) }
  // нужни позиции по подразбиране
  const positions = fd.getAll('positions').map(String)
  if (positions.length) {
    const { data: pos } = await supabase.from('positions').select('id, team_id, default_count').in('id', positions)
    await supabase.from('plan_needs').insert((pos ?? []).map((p) => ({ event_id: data.id, position_id: p.id, team_id: p.team_id, needed: Math.max(1, p.default_count) })))
  }
  redirect(`/events/${data.id}`)
}

export async function cancelEvent(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const id = str(fd, 'id')!
  const cancel = fd.get('cancel') === 'true'
  const { data: ev, error } = await supabase.from('events').update({ is_cancelled: cancel }).eq('id', id).select('title, starts_at').single()
  if (error) return { error: dbError(error) }
  if (cancel) {
    const { data: as } = await supabase.from('assignments').select('profile_id').eq('event_id', id).neq('status', 'declined')
    await notify((as ?? []).map((a) => a.profile_id), { title: 'Отменено събитие', body: `„${ev.title}“ (${fmtDateTime(ev.starts_at)}) е отменено.`, url: `/events/${id}` })
  }
  rev(id)
  return { ok: cancel ? 'Събитието е отменено' : 'Събитието е възстановено' }
}

export async function deleteEvent(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { error } = await supabase.from('events').delete().eq('id', str(fd, 'id')!)
  if (error) return { error: dbError(error) }
  redirect('/events')
}

// ---------------- Програма, бележки, файлове ----------------
export async function addPlanItem(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const event_id = str(fd, 'event_id')!
  const { count } = await supabase.from('plan_items').select('id', { count: 'exact', head: true }).eq('event_id', event_id)
  const { error } = await supabase.from('plan_items').insert({
    event_id, team_id: str(fd, 'team_id'), title: str(fd, 'title'), duration_minutes: num(fd, 'duration_minutes'), notes: str(fd, 'notes'), sort: (count ?? 0) + 1,
  })
  if (error) return { error: dbError(error) }
  rev(event_id)
  return { ok: 'Добавено' }
}

export async function movePlanItem(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const event_id = str(fd, 'event_id')!
  const id = str(fd, 'id')!
  const dir = Number(str(fd, 'dir'))
  const { data: items } = await supabase.from('plan_items').select('id, sort').eq('event_id', event_id).order('sort').order('created_at')
  const list = items ?? []
  const i = list.findIndex((x) => x.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return null as any
  ;[list[i], list[j]] = [list[j], list[i]]
  await Promise.all(list.map((x, k) => supabase.from('plan_items').update({ sort: k + 1 }).eq('id', x.id)))
  rev(event_id)
  return { ok: '' }
}

export async function deletePlanRow(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const table = str(fd, 'table')!
  if (!['plan_items', 'plan_notes', 'plan_files'].includes(table)) return { error: 'Невалидно' }
  if (table === 'plan_files') {
    const { data: f } = await supabase.from('plan_files').select('storage_path').eq('id', str(fd, 'id')!).single()
    if (f) await supabase.storage.from('plan-files').remove([f.storage_path])
  }
  const { error } = await supabase.from(table).delete().eq('id', str(fd, 'id')!)
  if (error) return { error: dbError(error) }
  rev(str(fd, 'event_id'))
  return { ok: 'Изтрито' }
}

export async function addPlanNote(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const { error } = await supabase.from('plan_notes').insert({ event_id: str(fd, 'event_id'), team_id: str(fd, 'team_id'), body: str(fd, 'body'), author_id: me.id })
  if (error) return { error: dbError(error) }
  rev(str(fd, 'event_id'))
  return { ok: 'Добавено' }
}

export async function registerPlanFile(eventId: string, teamId: string | null, name: string, path: string): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const { error } = await supabase.from('plan_files').insert({ event_id: eventId, team_id: teamId, name, storage_path: path, uploaded_by: me.id })
  if (error) {
    await supabase.storage.from('plan-files').remove([path])
    return { error: dbError(error) }
  }
  rev(eventId)
  return { ok: 'Файлът е качен' }
}

// ---------------- Нужни позиции ----------------
export async function setNeed(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const event_id = str(fd, 'event_id')!
  const position_id = str(fd, 'position_id')!
  const needed = num(fd, 'needed') ?? 0
  const { data: pos } = await supabase.from('positions').select('team_id').eq('id', position_id).single()
  const { error } = needed <= 0 && fd.get('remove') === 'true'
    ? await supabase.from('plan_needs').delete().eq('event_id', event_id).eq('position_id', position_id)
    : await supabase.from('plan_needs').upsert({ event_id, position_id, team_id: pos?.team_id, needed }, { onConflict: 'event_id,position_id' })
  if (error) return { error: dbError(error) }
  rev(event_id)
  return { ok: 'Запазено' }
}

// ---------------- Разпределяне ----------------
async function inviteNotice(supabase: any, assignmentIds: string[]) {
  if (!assignmentIds.length) return
  const { data } = await supabase.from('assignments').select('id, profile_id, event_id, events(title, starts_at), positions(name), teams(name)').in('id', assignmentIds)
  for (const a of data ?? []) {
    await notify([a.profile_id], {
      title: 'Покана за служение',
      body: `${a.teams?.name} – ${a.positions?.name}: „${a.events?.title}“, ${fmtDateTime(a.events?.starts_at)}. Потвърдете или откажете.`,
      url: '/my', tag: 'invite-' + a.id,
    })
  }
}

export async function assignPerson(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const event_id = str(fd, 'event_id')!
  const profile_id = str(fd, 'profile_id')
  if (!profile_id) return { error: 'Изберете човек' }
  const { data, error } = await supabase.from('assignments')
    .insert({ event_id, position_id: str(fd, 'position_id'), profile_id, assigned_by: me.id, status: profile_id === me.id ? 'confirmed' : 'pending' })
    .select('id').single()
  if (error) return { error: dbError(error) }
  if (profile_id !== me.id) await inviteNotice(supabase, [data.id])
  rev(event_id)
  return { ok: 'Поканата е изпратена' }
}

export async function removeAssignment(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { data: a } = await supabase.from('assignments').select('profile_id, status, events(title, starts_at)').eq('id', str(fd, 'id')!).single()
  const { error } = await supabase.from('assignments').delete().eq('id', str(fd, 'id')!)
  if (error) return { error: dbError(error) }
  if (a && a.status !== 'declined') {
    const ev: any = a.events
    await notify([a.profile_id], { title: 'Промяна в графика', body: `Вече не сте в графика за „${ev?.title}“ (${fmtDateTime(ev?.starts_at)}).`, url: '/my' })
  }
  rev(str(fd, 'event_id'))
  return { ok: 'Премахнато' }
}

export async function resendInvite(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const id = str(fd, 'id')!
  const { error } = await supabase.from('assignments').update({ status: 'pending', decline_reason: null }).eq('id', id)
  if (error) return { error: dbError(error) }
  await inviteNotice(supabase, [id])
  rev(str(fd, 'event_id'))
  return { ok: 'Изпратено отново' }
}

/** Автоматично попълване: от отбелязалите се като свободни, като предпочита служилите най-отдавна */
export async function autofill(eventId: string, teamId: string): Promise<Result & { filled?: number }> {
  const me = await requireMe()
  const supabase = await createClient()
  const [{ data: needs }, { data: existing }, { data: cands, error: cErr }] = await Promise.all([
    supabase.from('plan_needs').select('position_id, needed, positions(name, sort)').eq('event_id', eventId).eq('team_id', teamId),
    supabase.from('assignments').select('position_id, profile_id, status').eq('event_id', eventId).eq('team_id', teamId),
    supabase.rpc('event_team_candidates', { p_event: eventId, p_team: teamId }),
  ])
  if (cErr) return { error: dbError(cErr) }
  const taken = new Set((existing ?? []).filter((a) => a.status !== 'declined').map((a) => a.profile_id))
  const declinedHere = new Set((existing ?? []).filter((a) => a.status === 'declined').map((a) => `${a.profile_id}:${a.position_id}`))
  const pool = ((cands ?? []) as any[])
    .filter((c) => c.available && !c.cannot && !c.blocked && !c.busy)
    .sort((a, b) => (a.last_served ?? '').localeCompare(b.last_served ?? '') || a.times_90d - b.times_90d)
  const created: string[] = []
  const sortedNeeds = (needs ?? []).sort((a: any, b: any) => (a.positions?.sort ?? 0) - (b.positions?.sort ?? 0))
  const skipped: string[] = []
  for (const n of sortedNeeds as any[]) {
    let open = n.needed - (existing ?? []).filter((a) => a.position_id === n.position_id && a.status !== 'declined').length
    const anyQualified = pool.some((c) => c.position_ids?.length)
    for (const c of pool) {
      if (open <= 0) break
      if (taken.has(c.profile_id) || declinedHere.has(`${c.profile_id}:${n.position_id}`)) continue
      if (anyQualified && c.position_ids?.length && !c.position_ids.includes(n.position_id)) continue
      if (anyQualified && !c.position_ids?.length) continue
      const { data, error } = await supabase.from('assignments')
        .insert({ event_id: eventId, position_id: n.position_id, profile_id: c.profile_id, assigned_by: me.id }).select('id').single()
      if (error) { skipped.push(fullName(c)); continue }
      created.push(data.id); taken.add(c.profile_id); open--
    }
  }
  await inviteNotice(supabase, created)
  rev(eventId)
  if (!created.length) return { error: 'Няма подходящи свободни хора. Помолете екипа да отбележи свободните си дати в „Моят календар“.' }
  return { ok: `Изпратени покани: ${created.length}${skipped.length ? ` (пропуснати заради конфликт: ${skipped.join(', ')})` : ''}`, filled: created.length }
}

export async function autofillAction(_: unknown, fd: FormData): Promise<Result> {
  return autofill(str(fd, 'event_id')!, str(fd, 'team_id')!)
}

// ---------------- Отговор на поканата ----------------
export async function respond(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const id = str(fd, 'id')!
  const status = str(fd, 'status') as 'confirmed' | 'declined'
  const reason = str(fd, 'reason')
  const { data: a, error } = await supabase.from('assignments')
    .update({ status, decline_reason: status === 'declined' ? reason : null })
    .eq('id', id).eq('profile_id', me.id)
    .select('event_id, team_id, events(title, starts_at), positions(name)').single()
  if (error) return { error: dbError(error) }
  if (status === 'declined') {
    // известието в приложението се създава от базата; тук пращаме push до лидерите
    const leaders = await teamLeaderIds(a.team_id)
    const ev: any = a.events
    await sendPush(leaders, {
      title: `Отказ: ${fullName(me.profile)}`,
      body: `${(a.positions as any)?.name} – „${ev?.title}“ (${fmtDateTime(ev?.starts_at)})${reason ? ': ' + reason : ''}`,
      url: `/events/${a.event_id}?team=${a.team_id}`,
    })
  }
  rev(a.event_id)
  return { ok: status === 'confirmed' ? 'Потвърдено. Благодарим!' : 'Отказано. Лидерът е уведомен.' }
}

/** Самостоятелно записване (ако екипът го позволява) */
export async function selfSignup(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const event_id = str(fd, 'event_id')!
  const { error } = await supabase.from('assignments').insert({ event_id, position_id: str(fd, 'position_id'), profile_id: me.id, assigned_by: me.id, status: 'confirmed' })
  if (error) return { error: dbError(error) }
  rev(event_id)
  return { ok: 'Записахте се!' }
}

// ---------------- Свободни дати ----------------
export async function setAvailability(eventId: string, teamId: string | null, on: boolean): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  let q = supabase.from('availability').delete().eq('profile_id', me.id).eq('event_id', eventId)
  q = teamId ? q.eq('team_id', teamId) : q.is('team_id', null)
  const { error: dErr } = await q
  if (dErr) return { error: dbError(dErr) }
  if (on) {
    if (!teamId) {
      // „Не мога“ премахва отметките „свободен“
      await supabase.from('availability').delete().eq('profile_id', me.id).eq('event_id', eventId)
    } else {
      await supabase.from('availability').delete().eq('profile_id', me.id).eq('event_id', eventId).is('team_id', null)
    }
    const { error } = await supabase.from('availability').insert({ profile_id: me.id, event_id: eventId, team_id: teamId, status: teamId ? 'available' : 'unavailable' })
    if (error) return { error: dbError(error) }
  }
  revalidatePath('/my')
  return { ok: 'Запазено' }
}

export async function addBlockout(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const starts_on = str(fd, 'starts_on')
  const ends_on = str(fd, 'ends_on') ?? starts_on
  if (!starts_on) return { error: 'Изберете дата' }
  const { error } = await supabase.from('blockouts').insert({ profile_id: me.id, starts_on, ends_on, reason: str(fd, 'reason') })
  if (error) return { error: dbError(error) }
  // предупреждение, ако вече е записан в този период
  const { data: clash } = await supabase.from('assignments').select('id, events!inner(title, starts_at)')
    .eq('profile_id', me.id).neq('status', 'declined')
    .gte('events.starts_at', new Date(starts_on + 'T00:00:00+02:00').toISOString())
    .lte('events.starts_at', new Date(ends_on + 'T23:59:59+02:00').toISOString())
  revalidatePath('/my')
  if (clash?.length) return { ok: `Записано. Внимание: в този период сте в графика за ${clash.map((c: any) => '„' + c.events.title + '“').join(', ')} – откажете поканите, ако няма да можете.` }
  return { ok: 'Отсъствието е записано' }
}

export async function deleteBlockout(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { error } = await supabase.from('blockouts').delete().eq('id', str(fd, 'id')!)
  if (error) return { error: dbError(error) }
  revalidatePath('/my')
  return { ok: 'Изтрито' }
}

// ---------------- Серии ----------------
export async function saveSeries(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const row = {
    title: str(fd, 'title'), description: str(fd, 'description'), weekday: num(fd, 'weekday'), start_time: str(fd, 'start_time'),
    duration_minutes: num(fd, 'duration_minutes') ?? 120, interval_weeks: num(fd, 'interval_weeks') ?? 1, room_id: str(fd, 'room_id'),
    starts_on: str(fd, 'starts_on') ?? new Date().toISOString().slice(0, 10), ends_on: str(fd, 'ends_on'), visibility: str(fd, 'visibility') ?? 'all',
  }
  if (!row.title || !row.weekday || !row.start_time) return { error: 'Попълнете заглавие, ден и час' }
  const { data, error } = await supabase.from('event_series').insert({ ...row, created_by: me.id }).select('id').single()
  if (error) return { error: dbError(error) }
  const positions = fd.getAll('positions').map(String)
  if (positions.length) {
    const { data: pos } = await supabase.from('positions').select('id, default_count').in('id', positions)
    await supabase.from('series_needs').insert((pos ?? []).map((p) => ({ series_id: data.id, position_id: p.id, needed: Math.max(1, p.default_count) })))
  }
  const weeks = num(fd, 'generate_weeks') ?? 8
  const until = new Date(Date.now() + weeks * 7 * 864e5).toISOString().slice(0, 10)
  const { data: n, error: gErr } = await supabase.rpc('generate_series_events', { p_series: data.id, p_until: until })
  if (gErr) return { error: dbError(gErr) }
  revalidatePath('/events')
  return { ok: `Серията е създадена. Създадени събития: ${n}` }
}

export async function generateSeries(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const weeks = num(fd, 'weeks') ?? 8
  const until = new Date(Date.now() + weeks * 7 * 864e5).toISOString().slice(0, 10)
  const { data: n, error } = await supabase.rpc('generate_series_events', { p_series: str(fd, 'id'), p_until: until })
  if (error) return { error: dbError(error) }
  revalidatePath('/events')
  return { ok: `Добавени събития: ${n}` }
}

export async function deleteSeries(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const id = str(fd, 'id')!
  if (fd.get('with_events') === 'on') {
    await supabase.from('events').delete().eq('series_id', id).gte('starts_at', new Date().toISOString())
  }
  const { error } = await supabase.from('event_series').delete().eq('id', id)
  if (error) return { error: dbError(error) }
  revalidatePath('/events')
  return { ok: 'Серията е изтрита' }
}

/** Автоматично попълване за всички събития в матрицата */
export async function autofillMany(_: unknown, fd: FormData): Promise<Result> {
  const teamId = str(fd, 'team_id')!
  const ids = fd.getAll('event_ids').map(String)
  let total = 0
  for (const e of ids) {
    const r = await autofill(e, teamId)
    total += r.filled ?? 0
  }
  return total ? { ok: `Изпратени покани: ${total}` } : { error: 'Няма подходящи свободни хора за незаетите места.' }
}

/** Прилагане на шаблон за ротация върху събитията на екипа в период */
export async function applyRotation(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const { data: tpl } = await supabase.from('rotation_templates').select('*').eq('id', str(fd, 'id')!).single()
  if (!tpl) return { error: 'Шаблонът не е намерен' }
  const from = str(fd, 'from')!
  const to = str(fd, 'to')!
  const seriesId = str(fd, 'series_id')
  let q = supabase.from('events').select('id, starts_at').eq('is_cancelled', false)
    .gte('starts_at', new Date(from + 'T00:00:00Z').toISOString()).lte('starts_at', new Date(to + 'T23:59:59Z').toISOString()).order('starts_at')
  if (seriesId) q = q.eq('series_id', seriesId)
  const { data: events } = await q
  if (!events?.length) return { error: 'Няма събития в този период' }
  const created: string[] = []
  const conflicts: string[] = []
  for (const [i, e] of events.entries()) {
    const week = i % tpl.weeks
    for (const s of (tpl.slots as any[]).filter((x) => x.week === week)) {
      const { data, error } = await supabase.from('assignments')
        .insert({ event_id: e.id, position_id: s.position_id, profile_id: s.profile_id, assigned_by: me.id }).select('id').single()
      if (error) { if (!/duplicate|unique/i.test(error.message)) conflicts.push(dbError(error)); continue }
      created.push(data.id)
    }
  }
  await inviteNotice(supabase, created)
  revalidatePath(`/teams/${tpl.team_id}/matrix`)
  return { ok: `Създадени покани: ${created.length}${conflicts.length ? `. Пропуснати (${conflicts.length}): ${[...new Set(conflicts)].slice(0, 3).join('; ')}` : ''}` }
}

export async function saveRotation(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const team_id = str(fd, 'team_id')!
  const weeks = Math.min(Math.max(num(fd, 'weeks') ?? 4, 1), 12)
  const slots: any[] = []
  for (const [k, v] of fd.entries()) {
    const m = /^slot:(\d+):([0-9a-f-]+)$/.exec(k)
    if (m && typeof v === 'string' && v) slots.push({ week: Number(m[1]), position_id: m[2], profile_id: v })
  }
  const id = str(fd, 'id')
  const row = { team_id, name: str(fd, 'name') ?? 'Ротация', weeks, slots }
  const { error } = id ? await supabase.from('rotation_templates').update(row).eq('id', id) : await supabase.from('rotation_templates').insert({ ...row, created_by: me.id })
  if (error) return { error: dbError(error) }
  revalidatePath(`/teams/${team_id}/rotations`)
  return { ok: 'Шаблонът е запазен' }
}

export async function deleteRotation(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { error } = await supabase.from('rotation_templates').delete().eq('id', str(fd, 'id')!)
  if (error) return { error: dbError(error) }
  revalidatePath(`/teams/${str(fd, 'team_id')}/rotations`)
  return { ok: 'Изтрит' }
}

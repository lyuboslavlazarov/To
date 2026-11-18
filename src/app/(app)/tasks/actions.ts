'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dbError, str, num, bool, type Result } from '@/lib/actions'
import { fromLocalInput } from '@/lib/format'
import { notify, teamLeaderIds } from '@/lib/notify'

export async function createTask(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const is_issue = bool(fd, 'is_issue')
  const row = {
    title: str(fd, 'title'), description: str(fd, 'description'), team_id: str(fd, 'team_id'), assignee_id: str(fd, 'assignee_id'),
    due_at: fromLocalInput(str(fd, 'due_at')), is_issue, location: str(fd, 'location'), priority: num(fd, 'priority') ?? 2,
    photo_path: str(fd, 'photo_path'), created_by: me.id,
  }
  if (!row.title) return { error: 'Въведете заглавие' }
  const { data, error } = await supabase.from('tasks').insert(row).select('id').single()
  if (error) return { error: dbError(error) }
  if (row.assignee_id && row.assignee_id !== me.id) await notify([row.assignee_id], { title: 'Нова задача за вас', body: row.title!, url: `/tasks/${data.id}` })
  if (is_issue && row.team_id) {
    const leaders = await teamLeaderIds(row.team_id)
    await notify(leaders, { title: `🔧 Сигнал за повреда${row.priority === 1 ? ' (СПЕШНО)' : ''}`, body: `${row.title}${row.location ? ' – ' + row.location : ''} (от ${fullName(me.profile)})`, url: `/tasks/${data.id}` })
  }
  revalidatePath('/tasks')
  redirect(`/tasks/${data.id}`)
}

export async function updateTask(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const id = str(fd, 'id')!
  const patch: any = {}
  if (fd.has('status')) {
    patch.status = str(fd, 'status')
    patch.completed_at = patch.status === 'done' ? new Date().toISOString() : null
  }
  if (fd.has('assignee_id')) patch.assignee_id = str(fd, 'assignee_id')
  if (fd.has('team_id')) patch.team_id = str(fd, 'team_id')
  if (fd.has('due_at')) patch.due_at = fromLocalInput(str(fd, 'due_at'))
  const { data, error } = await supabase.from('tasks').update(patch).eq('id', id).select('title, created_by, assignee_id').single()
  if (error) return { error: dbError(error) }
  if (patch.assignee_id && patch.assignee_id !== me.id) await notify([patch.assignee_id], { title: 'Възложена ви е задача', body: data.title, url: `/tasks/${id}` })
  if (patch.status === 'done' && data.created_by && data.created_by !== me.id) await notify([data.created_by], { title: '✓ Задачата е изпълнена', body: data.title, url: `/tasks/${id}` })
  revalidatePath(`/tasks/${id}`)
  revalidatePath('/tasks')
  return { ok: 'Запазено' }
}

export async function setTaskPhoto(id: string, field: 'photo_path' | 'proof_path', path: string): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { error } = await supabase.from('tasks').update({ [field]: path }).eq('id', id)
  if (error) return { error: dbError(error) }
  revalidatePath(`/tasks/${id}`)
  return { ok: 'Снимката е качена' }
}

export async function deleteTask(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { error } = await supabase.from('tasks').delete().eq('id', str(fd, 'id')!)
  if (error) return { error: dbError(error) }
  redirect('/tasks')
}

// ---------- Чеклисти ----------
export async function toggleItem(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const done = fd.get('done') === 'true'
  const { error } = await supabase.from('checklist_items').update({ done_at: done ? new Date().toISOString() : null, ...(done ? {} : { done_by: null }) }).eq('id', str(fd, 'id')!)
  if (error) return { error: dbError(error) }
  revalidatePath(`/tasks/checklists/${str(fd, 'checklist_id')}`)
  return { ok: '' }
}

export async function setItemPhoto(itemId: string, checklistId: string, path: string): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { error } = await supabase.from('checklist_items').update({ photo_path: path }).eq('id', itemId)
  if (error) return { error: dbError(error) }
  revalidatePath(`/tasks/checklists/${checklistId}`)
  return { ok: 'Снимката е качена' }
}

export async function assignChecklist(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const id = str(fd, 'id')!
  const assignee = str(fd, 'assignee_id')
  const { data, error } = await supabase.from('checklists').update({ assignee_id: assignee }).eq('id', id).select('title').single()
  if (error) return { error: dbError(error) }
  if (assignee) await notify([assignee], { title: 'Възложен ви е чеклист', body: data.title, url: `/tasks/checklists/${id}` })
  revalidatePath(`/tasks/checklists/${id}`)
  return { ok: 'Запазено' }
}

export async function saveTemplate(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const id = str(fd, 'id')
  const row = {
    team_id: str(fd, 'team_id'), title: str(fd, 'title'), description: str(fd, 'description'), recurrence: str(fd, 'recurrence') ?? 'weekly',
    weekday: num(fd, 'weekday'), month_day: num(fd, 'month_day'), due_time: str(fd, 'due_time') ?? '18:00',
    default_assignee_id: str(fd, 'default_assignee_id'), is_active: fd.has('is_active') ? fd.getAll('is_active').includes('on') : true,
  }
  if (!row.title || !row.team_id) return { error: 'Попълнете заглавие и екип' }
  const items = (str(fd, 'items') ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
  let tid = id
  if (id) {
    const { error } = await supabase.from('checklist_templates').update(row).eq('id', id)
    if (error) return { error: dbError(error) }
    await supabase.from('checklist_template_items').delete().eq('template_id', id)
  } else {
    const { data, error } = await supabase.from('checklist_templates').insert({ ...row, created_by: me.id }).select('id').single()
    if (error) return { error: dbError(error) }
    tid = data.id
  }
  if (items.length) {
    const { error } = await supabase.from('checklist_template_items').insert(items.map((t, i) => ({
      template_id: tid, sort: i + 1, title: t.replace(/\s*\[снимка\]\s*$/i, ''), requires_photo: /\[снимка\]\s*$/i.test(t),
    })))
    if (error) return { error: dbError(error) }
  }
  if (row.recurrence !== 'none') await supabase.rpc('generate_team_checklists', { p_team: row.team_id })
  revalidatePath('/tasks/templates')
  return { ok: 'Шаблонът е запазен' }
}

export async function runTemplateNow(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const { data: t } = await supabase.from('checklist_templates').select('*, checklist_template_items(*)').eq('id', str(fd, 'id')!).single()
  if (!t) return { error: 'Не е намерен' }
  const { data: cl, error } = await supabase.from('checklists').insert({
    template_id: t.id, team_id: t.team_id, title: t.title, due_at: fromLocalInput(str(fd, 'due_at')) ?? new Date(Date.now() + 864e5).toISOString(),
    assignee_id: t.default_assignee_id, period_key: 'manual-' + Date.now(),
  }).select('id').single()
  if (error) return { error: dbError(error) }
  await supabase.from('checklist_items').insert((t.checklist_template_items ?? []).map((i: any) => ({ checklist_id: cl.id, sort: i.sort, title: i.title, requires_photo: i.requires_photo })))
  if (t.default_assignee_id && t.default_assignee_id !== me.id) await notify([t.default_assignee_id], { title: 'Нов чеклист', body: t.title, url: `/tasks/checklists/${cl.id}` })
  redirect(`/tasks/checklists/${cl.id}`)
}

export async function deleteTemplate(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { error } = await supabase.from('checklist_templates').delete().eq('id', str(fd, 'id')!)
  if (error) return { error: dbError(error) }
  revalidatePath('/tasks/templates')
  return { ok: 'Изтрит' }
}

'use server'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError, str, num, bool, type Result } from '@/lib/actions'
import { notify } from '@/lib/notify'

export async function approvePerson(_: unknown, fd: FormData): Promise<Result> {
  await requireAdmin()
  const supabase = await createClient()
  const id = str(fd, 'id')!
  const role = (str(fd, 'role') ?? 'member') as string
  const teams = fd.getAll('teams').map(String)
  const { error } = await supabase.from('profiles').update({ status: 'active', system_role: role }).eq('id', id)
  if (error) return { error: dbError(error) }
  if (teams.length) {
    const { error: e2 } = await supabase.from('team_members').upsert(teams.map((team_id) => ({ team_id, profile_id: id })), { onConflict: 'team_id,profile_id' })
    if (e2) return { error: dbError(e2) }
  }
  await notify([id], { title: 'Профилът ви е одобрен 🎉', body: 'Добре дошли! Вече имате достъп до платформата.', url: '/' }, { email: true, inApp: true })
  revalidatePath('/admin')
  return { ok: 'Одобрен' }
}

export async function rejectPerson(_: unknown, fd: FormData): Promise<Result> {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase.from('profiles').update({ status: 'inactive' }).eq('id', str(fd, 'id')!)
  if (error) return { error: dbError(error) }
  revalidatePath('/admin')
  return { ok: 'Отхвърлен' }
}

/** Администраторът добавя човек директно – получава покана по имейл */
export async function invitePerson(_: unknown, fd: FormData): Promise<Result> {
  await requireAdmin()
  const email = str(fd, 'email')?.toLowerCase()
  if (!email) return { error: 'Въведете имейл' }
  const admin = createAdminClient()
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? ''
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { first_name: str(fd, 'first_name') ?? '', last_name: str(fd, 'last_name') ?? '', phone: str(fd, 'phone') ?? '' },
    redirectTo: `${site}/auth/callback`,
  })
  if (error) return { error: /already/i.test(error.message) ? 'Вече има профил с този имейл' : error.message }
  const supabase = await createClient()
  const { error: e2 } = await supabase.from('profiles').update({ status: 'active', system_role: str(fd, 'role') ?? 'member' }).eq('id', data.user.id)
  if (e2) return { error: dbError(e2) }
  const teams = fd.getAll('teams').map(String)
  if (teams.length) await supabase.from('team_members').insert(teams.map((team_id) => ({ team_id, profile_id: data.user.id })))
  revalidatePath('/people')
  return { ok: `Поканата е изпратена до ${email}` }
}

export async function setRoleStatus(_: unknown, fd: FormData): Promise<Result> {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase.from('profiles').update({ system_role: str(fd, 'role'), status: str(fd, 'status') }).eq('id', str(fd, 'id')!)
  if (error) return { error: dbError(error) }
  revalidatePath('/people/' + str(fd, 'id'))
  return { ok: 'Запазено' }
}

// ---------- Структура ----------
export async function saveDepartment(_: unknown, fd: FormData): Promise<Result> {
  await requireAdmin()
  const supabase = await createClient()
  const id = str(fd, 'id')
  const row = { name: str(fd, 'name'), description: str(fd, 'description'), color: str(fd, 'color') ?? '#6366f1', sort: num(fd, 'sort') ?? 0 }
  if (!row.name) return { error: 'Въведете име' }
  const { error } = id ? await supabase.from('departments').update(row).eq('id', id) : await supabase.from('departments').insert(row)
  if (error) return { error: dbError(error) }
  revalidatePath('/admin/structure')
  return { ok: 'Запазено' }
}

export async function deleteRow(_: unknown, fd: FormData): Promise<Result> {
  await requireAdmin()
  const table = str(fd, 'table')!
  if (!['departments', 'teams', 'positions', 'rooms', 'department_leaders'].includes(table)) return { error: 'Невалидно' }
  const supabase = await createClient()
  const q = supabase.from(table).delete()
  const { error } = table === 'department_leaders'
    ? await q.eq('department_id', str(fd, 'department_id')!).eq('profile_id', str(fd, 'profile_id')!)
    : await q.eq('id', str(fd, 'id')!)
  if (error) return { error: dbError(error) }
  revalidatePath('/admin', 'layout')
  return { ok: 'Изтрито' }
}

export async function saveTeam(_: unknown, fd: FormData): Promise<Result> {
  await requireAdmin()
  const supabase = await createClient()
  const id = str(fd, 'id')
  const row: any = {
    department_id: str(fd, 'department_id'), name: str(fd, 'name'), description: str(fd, 'description'), sort: num(fd, 'sort') ?? 0,
    allow_self_signup: bool(fd, 'allow_self_signup'), permissions: fd.getAll('permissions').map(String),
    min_age: num(fd, 'min_age'), max_age: num(fd, 'max_age'),
  }
  if (!row.name) return { error: 'Въведете име' }
  const { error } = id ? await supabase.from('teams').update(row).eq('id', id) : await supabase.from('teams').insert(row)
  if (error) return { error: dbError(error) }
  revalidatePath('/admin/structure')
  return { ok: 'Запазено' }
}

export async function savePosition(_: unknown, fd: FormData): Promise<Result> {
  await requireAdmin()
  const supabase = await createClient()
  const id = str(fd, 'id')
  const row = { team_id: str(fd, 'team_id'), name: str(fd, 'name'), default_count: num(fd, 'default_count') ?? 1, sort: num(fd, 'sort') ?? 0 }
  if (!row.name) return { error: 'Въведете име' }
  const { error } = id ? await supabase.from('positions').update(row).eq('id', id) : await supabase.from('positions').insert(row)
  if (error) return { error: dbError(error) }
  revalidatePath('/admin/structure')
  return { ok: 'Запазено' }
}

export async function addDepartmentLeader(_: unknown, fd: FormData): Promise<Result> {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase.from('department_leaders').insert({ department_id: str(fd, 'department_id'), profile_id: str(fd, 'profile_id') })
  if (error) return { error: dbError(error) }
  revalidatePath('/admin/structure')
  return { ok: 'Добавен' }
}

export async function saveRoom(_: unknown, fd: FormData): Promise<Result> {
  await requireAdmin()
  const supabase = await createClient()
  const id = str(fd, 'id')
  const row = { name: str(fd, 'name'), capacity: num(fd, 'capacity'), seat_rows: num(fd, 'seat_rows'), seats_per_row: num(fd, 'seats_per_row'), is_bookable: bool(fd, 'is_bookable'), description: str(fd, 'description') }
  if (!row.name) return { error: 'Въведете име' }
  const { error } = id ? await supabase.from('rooms').update(row).eq('id', id) : await supabase.from('rooms').insert(row)
  if (error) return { error: dbError(error) }
  revalidatePath('/admin/rooms')
  return { ok: 'Запазено' }
}

export async function saveSettings(_: unknown, fd: FormData): Promise<Result> {
  await requireAdmin()
  const supabase = await createClient()
  const rows = [
    { key: 'org_name', value: str(fd, 'org_name') ?? '' },
    { key: 'require_mfa_for_staff', value: bool(fd, 'require_mfa_for_staff') },
  ]
  const { error } = await supabase.from('app_settings').upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })))
  if (error) return { error: dbError(error) }
  revalidatePath('/admin/settings')
  return { ok: 'Настройките са запазени' }
}

export async function handleDataRequest(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireAdmin()
  const supabase = await createClient()
  const id = str(fd, 'id')!
  const decision = str(fd, 'decision')
  const { data: req } = await supabase.from('data_requests').select('*').eq('id', id).single()
  if (!req) return { error: 'Не е намерена' }
  if (decision === 'delete' && req.kind === 'delete') {
    // Изтриване на акаунта (каскадно изтрива профила и личните данни)
    const admin = createAdminClient()
    const { error } = await admin.auth.admin.deleteUser(req.profile_id)
    if (error) return { error: error.message }
    revalidatePath('/admin/gdpr')
    return { ok: 'Профилът и данните са изтрити' }
  }
  const { error } = await supabase.from('data_requests').update({ status: decision === 'reject' ? 'rejected' : 'done', handled_at: new Date().toISOString(), handled_by: me.id }).eq('id', id)
  if (error) return { error: dbError(error) }
  revalidatePath('/admin/gdpr')
  return { ok: 'Обработено' }
}

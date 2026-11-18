'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dbError, str, bool, type Result } from '@/lib/actions'

export async function saveChild(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const id = str(fd, 'id')
  const consent = bool(fd, 'consent')
  const row: any = {
    first_name: str(fd, 'first_name'), last_name: str(fd, 'last_name'), birthdate: str(fd, 'birthdate'),
    group_team_id: str(fd, 'group_team_id'), photo_consent: bool(fd, 'photo_consent'),
  }
  if (!row.first_name || !row.last_name) return { error: 'Въведете име и фамилия' }
  if (!id && !consent) return { error: 'Нужно е съгласие на родителя за обработка на данните' }
  if (consent) { row.consent_at = new Date().toISOString(); row.consent_by_name = str(fd, 'g_first_name') ? `${str(fd, 'g_first_name')} ${str(fd, 'g_last_name') ?? ''}`.trim() : str(fd, 'consent_by_name') }
  let childId = id
  if (id) {
    const { error } = await supabase.from('children').update(row).eq('id', id)
    if (error) return { error: dbError(error) }
  } else {
    const { data, error } = await supabase.from('children').insert({ ...row, created_by: me.id }).select('id').single()
    if (error) return { error: dbError(error) }
    childId = data.id
  }
  // чувствителни данни – записват се само ако имаме право (учител на групата / главен лидер)
  if (fd.has('allergies')) {
    const { error } = await supabase.from('child_care').upsert({ child_id: childId, allergies: str(fd, 'allergies'), medical_notes: str(fd, 'medical_notes'), notes: str(fd, 'care_notes'), updated_at: new Date().toISOString() })
    if (error && !id) {
      // новото дете може още да не е в група, която учителят вижда
    } else if (error) return { error: dbError(error) }
  }
  // родител при създаване
  if (!id && str(fd, 'g_first_name')) {
    const phone = str(fd, 'g_phone')
    let gid: string | null = null
    if (phone) {
      const { data: g } = await supabase.from('guardians').select('id').eq('phone', phone).maybeSingle()
      gid = g?.id ?? null
    }
    if (!gid) {
      const { data: g, error } = await supabase.from('guardians').insert({ first_name: str(fd, 'g_first_name'), last_name: str(fd, 'g_last_name') ?? '', phone, email: str(fd, 'g_email') }).select('id').single()
      if (error) return { error: dbError(error) }
      gid = g.id
    }
    await supabase.from('child_guardians').insert({ child_id: childId, guardian_id: gid, relationship: str(fd, 'g_relationship') ?? 'родител' })
  }
  revalidatePath('/kids', 'layout')
  if (!id) redirect(`/kids/children/${childId}`)
  return { ok: 'Запазено' }
}

export async function addGuardian(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const child_id = str(fd, 'child_id')!
  const phone = str(fd, 'phone')
  let gid: string | null = null
  if (phone) gid = (await supabase.from('guardians').select('id').eq('phone', phone).maybeSingle()).data?.id ?? null
  if (!gid) {
    const { data, error } = await supabase.from('guardians').insert({ first_name: str(fd, 'first_name'), last_name: str(fd, 'last_name') ?? '', phone, email: str(fd, 'email') }).select('id').single()
    if (error) return { error: dbError(error) }
    gid = data.id
  }
  const { error } = await supabase.from('child_guardians').insert({ child_id, guardian_id: gid, relationship: str(fd, 'relationship') ?? 'родител', can_pick_up: bool(fd, 'can_pick_up') })
  if (error) return { error: dbError(error) }
  revalidatePath(`/kids/children/${child_id}`)
  return { ok: 'Добавен' }
}

export async function removeGuardian(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { error } = await supabase.from('child_guardians').delete().eq('child_id', str(fd, 'child_id')!).eq('guardian_id', str(fd, 'guardian_id')!)
  if (error) return { error: dbError(error) }
  revalidatePath(`/kids/children/${str(fd, 'child_id')}`)
  return { ok: 'Премахнат' }
}

export async function checkIn(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('kids_check_in', { p_child: str(fd, 'child_id'), p_event: str(fd, 'event_id') })
  if (error) return { error: dbError(error) }
  revalidatePath('/kids')
  if (fd.get('print') === 'on') redirect(`/kids-print/${data.id}?auto=1`)
  return { ok: `Регистриран. Код за родителя: ${data.code}` }
}

export async function checkOut(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('kids_check_out', { p_checkin: str(fd, 'checkin_id'), p_code: str(fd, 'code') ?? '', p_picked_up_by: str(fd, 'picked_up_by') })
  if (error) return { error: dbError(error) }
  revalidatePath('/kids')
  return data.ok ? { ok: data.message } : { error: data.message }
}

export async function deactivateChild(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const id = str(fd, 'id')!
  const { error } = fd.get('delete') === 'true'
    ? await supabase.from('children').delete().eq('id', id)
    : await supabase.from('children').update({ is_active: false }).eq('id', id)
  if (error) return { error: dbError(error) }
  redirect('/kids/children')
}

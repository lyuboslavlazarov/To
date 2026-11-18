'use server'
import { revalidatePath } from 'next/cache'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dbError, str, bool, type Result } from '@/lib/actions'
import { fmtDate } from '@/lib/format'

export async function addGift(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const profile_id = str(fd, 'profile_id')!
  const item_name = str(fd, 'item_name')
  if (!item_name) return { error: 'Въведете какво е дадено' }
  if (!bool(fd, 'force')) {
    const { data: dups } = await supabase.rpc('gift_duplicates', { p_profile: profile_id, p_item: item_name })
    if (dups?.length) {
      return {
        error: `⚠ Внимание: човекът вече има ${dups.map((d: any) => `„${d.item_name}“ (${fmtDate(d.given_on)})`).join(', ')}. Ако все пак искате да добавите, отметнете „Добави въпреки това“.`,
      }
    }
  }
  const { error } = await supabase.from('gifts').insert({
    profile_id, item_name, kind: str(fd, 'kind') ?? 'gift', category: str(fd, 'category') ?? 'other',
    given_on: str(fd, 'given_on') ?? undefined, price: str(fd, 'price') ? Number(str(fd, 'price')) : null, notes: str(fd, 'notes'), created_by: me.id,
  })
  if (error) return { error: dbError(error) }
  revalidatePath(`/people/${profile_id}`)
  return { ok: 'Добавено' }
}

export async function deleteGift(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { error } = await supabase.from('gifts').delete().eq('id', str(fd, 'id')!)
  if (error) return { error: dbError(error) }
  revalidatePath(`/people/${str(fd, 'profile_id')}`)
  return { ok: 'Изтрито' }
}

export async function addNote(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const body = str(fd, 'body')
  if (!body) return { error: 'Празна бележка' }
  const { error } = await supabase.from('profile_notes').insert({ profile_id: str(fd, 'profile_id'), body, author_id: me.id, is_private: me.isLeadership && bool(fd, 'is_private') })
  if (error) return { error: dbError(error) }
  revalidatePath(`/people/${str(fd, 'profile_id')}`)
  return { ok: 'Бележката е добавена' }
}

export async function deleteNote(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { error } = await supabase.from('profile_notes').delete().eq('id', str(fd, 'id')!)
  if (error) return { error: dbError(error) }
  revalidatePath(`/people/${str(fd, 'profile_id')}`)
  return { ok: 'Изтрито' }
}

/** Редакция на профил – от самия човек или от администратора (RLS пази останалото) */
export async function saveProfile(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const id = str(fd, 'id')!
  const skills = (str(fd, 'skills') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const { error } = await supabase.from('profiles').update({
    first_name: str(fd, 'first_name') ?? '', last_name: str(fd, 'last_name') ?? '', phone: str(fd, 'phone'),
    birthday: str(fd, 'birthday'), tshirt_size: str(fd, 'tshirt_size'), skills,
  }).eq('id', id)
  if (error) return { error: dbError(error) }
  revalidatePath(`/people/${id}`)
  revalidatePath('/profile')
  return { ok: 'Профилът е запазен' }
}

export async function toggleMemberPosition(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const profile_id = str(fd, 'profile_id')!
  const position_id = str(fd, 'position_id')!
  const { error } = bool(fd, 'on')
    ? await supabase.from('member_positions').upsert({ profile_id, position_id })
    : await supabase.from('member_positions').delete().eq('profile_id', profile_id).eq('position_id', position_id)
  if (error) return { error: dbError(error) }
  revalidatePath(`/people/${profile_id}`)
  revalidatePath('/teams', 'layout')
  return { ok: 'Запазено' }
}

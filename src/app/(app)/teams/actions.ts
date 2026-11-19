'use server'
import { revalidatePath } from 'next/cache'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dbError, str, bool, type Result } from '@/lib/actions'
import { notify } from '@/lib/notify'

export async function addMember(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const team_id = str(fd, 'team_id')!
  const profile_id = str(fd, 'profile_id')!
  const { error } = await supabase.from('team_members').insert({ team_id, profile_id })
  if (error) return { error: dbError(error) }
  const { data: t } = await supabase.from('teams').select('name').eq('id', team_id).single()
  await notify([profile_id], { title: `Добавени сте в „${t?.name}“`, body: 'Вече виждате графика, задачите и чата на екипа.', url: `/teams/${team_id}` })
  revalidatePath(`/teams/${team_id}/members`)
  return { ok: 'Добавен' }
}

export async function removeMember(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const team_id = str(fd, 'team_id')!
  const { error } = await supabase.from('team_members').delete().eq('team_id', team_id).eq('profile_id', str(fd, 'profile_id')!)
  if (error) return { error: dbError(error) }
  revalidatePath(`/teams/${team_id}/members`)
  return { ok: 'Премахнат' }
}

export async function setLeader(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const team_id = str(fd, 'team_id')!
  const { error } = await supabase.from('team_members').update({ is_leader: bool(fd, 'is_leader') }).eq('team_id', team_id).eq('profile_id', str(fd, 'profile_id')!)
  if (error) return { error: dbError(error) }
  revalidatePath(`/teams/${team_id}/members`)
  return { ok: 'Запазено' }
}

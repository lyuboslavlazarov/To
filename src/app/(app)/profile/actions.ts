'use server'
import { revalidatePath } from 'next/cache'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dbError, str, type Result } from '@/lib/actions'

export async function setAvatar(url: string): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', me.id)
  if (error) return { error: dbError(error) }
  revalidatePath('/profile')
  return { ok: 'Снимката е сменена' }
}

export async function requestDeletion(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const { error } = await supabase.from('data_requests').insert({ profile_id: me.id, kind: 'delete', note: str(fd, 'note') })
  if (error) return { error: dbError(error) }
  return { ok: 'Заявката е изпратена до администратора.' }
}

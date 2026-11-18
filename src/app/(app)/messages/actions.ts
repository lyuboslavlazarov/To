'use server'
import { revalidatePath } from 'next/cache'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dbError, str, bool, type Result } from '@/lib/actions'
import { notify } from '@/lib/notify'

export async function sendAnnouncement(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const [audience, audience_id] = (str(fd, 'target') ?? 'all:').split(':')
  const row = { title: str(fd, 'title'), body: str(fd, 'body'), audience, audience_id: audience_id || null, author_id: me.id, author_name: fullName(me.profile), pinned: bool(fd, 'pinned') }
  if (!row.title || !row.body) return { error: 'Попълнете заглавие и текст' }
  const { data, error } = await supabase.from('announcements').insert(row).select('id').single()
  if (error) return { error: dbError(error) }
  const { data: members } = await supabase.rpc('audience_members', { p_audience: audience, p_id: audience_id || null })
  const ids = ((members ?? []) as any[]).map((m) => m.profile_id).filter((x) => x !== me.id)
  await notify(ids, { title: `📣 ${row.title}`, body: row.body!.slice(0, 180), url: `/messages#${data.id}` }, { push: bool(fd, 'push'), email: bool(fd, 'email') })
  revalidatePath('/messages')
  return { ok: `Изпратено до ${ids.length} души` }
}

export async function deleteAnnouncement(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { error } = await supabase.from('announcements').delete().eq('id', str(fd, 'id')!)
  if (error) return { error: dbError(error) }
  revalidatePath('/messages')
  return { ok: 'Изтрито' }
}

export async function sendChat(teamId: string, body: string): Promise<Result> {
  const me = await requireMe()
  const text = body.trim()
  if (!text) return null as any
  const supabase = await createClient()
  const { error } = await supabase.from('team_messages').insert({ team_id: teamId, author_id: me.id, author_name: fullName(me.profile), body: text.slice(0, 4000) })
  if (error) return { error: dbError(error) }
  // кратко известие до останалите членове
  const { data: members } = await supabase.from('team_members').select('profile_id, teams(name)').eq('team_id', teamId)
  const teamName = (members?.[0]?.teams as any)?.name ?? 'екипа'
  await notify((members ?? []).map((m) => m.profile_id).filter((x) => x !== me.id), {
    title: `💬 ${teamName}: ${fullName(me.profile)}`, body: text.slice(0, 140), url: `/teams/${teamId}/chat`, tag: 'chat-' + teamId,
  }, { inApp: false })
  return { ok: '' }
}

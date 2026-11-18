'use server'
import { revalidatePath } from 'next/cache'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dbError, str, type Result } from '@/lib/actions'
import { fromLocalInput } from '@/lib/format'

export async function bookRoom(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const starts_at = fromLocalInput(str(fd, 'starts_at'))
  const ends_at = fromLocalInput(str(fd, 'ends_at'))
  if (!starts_at || !ends_at || ends_at <= starts_at) return { error: 'Невалиден час' }
  const { error } = await supabase.from('room_bookings').insert({
    room_id: str(fd, 'room_id'), title: str(fd, 'title') ?? 'Резервация', starts_at, ends_at, team_id: str(fd, 'team_id'), notes: str(fd, 'notes'), booked_by: me.id,
  })
  if (error) return { error: dbError(error) }
  revalidatePath('/rooms')
  return { ok: 'Помещението е резервирано' }
}

export async function cancelBooking(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { error } = await supabase.from('room_bookings').delete().eq('id', str(fd, 'id')!)
  if (error) return { error: dbError(error) }
  revalidatePath('/rooms')
  return { ok: 'Резервацията е отменена' }
}

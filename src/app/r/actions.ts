'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { sendRegistrationEmail } from '@/lib/registrations'
import { dbError } from '@/lib/actions'

export async function publicRegister(_: unknown, fd: FormData) {
  if (fd.get('website')) return { error: 'Грешка' } // капан за ботове
  const slug = String(fd.get('slug'))
  const answers: Record<string, string> = {}
  for (const [k, v] of fd.entries()) if (k.startsWith('q_') && typeof v === 'string') answers[k.slice(2)] = v
  if (fd.get('consent') !== 'on') return { error: 'Моля, потвърдете съгласието за обработка на данните' }
  const seat = String(fd.get('seat') ?? '')
  const [row, num] = seat.includes('-') ? seat.split('-').map(Number) : [null, null]
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('public_register', {
    p_slug: slug, p_first_name: String(fd.get('first_name') ?? ''), p_last_name: String(fd.get('last_name') ?? ''),
    p_email: String(fd.get('email') ?? ''), p_phone: String(fd.get('phone') ?? ''), p_answers: answers,
    p_seat_row: row, p_seat_number: num,
  })
  if (error) return { error: dbError(error) }
  await sendRegistrationEmail(data.id, data.status === 'waitlist' ? 'waitlist' : 'confirmed')
  redirect(`/r/ticket/${data.qr_token}?new=1`)
}

export async function publicCancel(_: unknown, fd: FormData) {
  const supabase = await createClient()
  const token = String(fd.get('token'))
  const { data, error } = await supabase.rpc('public_cancel_registration', { p_cancel_token: token })
  if (error) return { error: dbError(error) }
  if (data?.promoted) await sendRegistrationEmail(data.promoted, 'promoted')
  return { ok: 'Регистрацията е отказана. Благодарим, че освободихте мястото!' }
}

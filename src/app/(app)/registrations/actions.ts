'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dbError, str, num, bool, type Result } from '@/lib/actions'
import { fromLocalInput } from '@/lib/format'
import { slugify } from '@/lib/translit'
import { sendRegistrationEmail } from '@/lib/registrations'

function parseQuestions(raw: string | null) {
  try {
    const q = JSON.parse(raw ?? '[]')
    return Array.isArray(q) ? q.filter((x) => x?.label).map((x, i) => ({
      id: x.id || `q${i + 1}`, label: String(x.label), type: ['text', 'textarea', 'select', 'checkbox'].includes(x.type) ? x.type : 'text',
      options: Array.isArray(x.options) ? x.options.map(String).filter(Boolean) : [], required: !!x.required,
    })) : []
  } catch { return [] }
}

export async function saveRegEvent(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const id = str(fd, 'id')
  const title = str(fd, 'title')
  if (!title) return { error: 'Въведете заглавие' }
  const use_seating = bool(fd, 'use_seating')
  const row: any = {
    title, description: str(fd, 'description'), location: str(fd, 'location'), event_id: str(fd, 'event_id'),
    starts_at: fromLocalInput(str(fd, 'starts_at')), closes_at: fromLocalInput(str(fd, 'closes_at')),
    capacity: num(fd, 'capacity') ?? 100, is_published: bool(fd, 'is_published'), is_open: bool(fd, 'is_open'),
    use_seating, seat_rows: use_seating ? num(fd, 'seat_rows') : null, seats_per_row: use_seating ? num(fd, 'seats_per_row') : null,
    blocked_seats: (str(fd, 'blocked_seats') ?? '').split(/[\s,;]+/).filter((s) => /^\d+-\d+$/.test(s)),
    questions: parseQuestions(str(fd, 'questions')), confirmation_text: str(fd, 'confirmation_text'),
  }
  if (use_seating) {
    if (!row.seat_rows || !row.seats_per_row) return { error: 'Въведете редове и места на ред' }
    const seats = row.seat_rows * row.seats_per_row - row.blocked_seats.length
    if (row.capacity > seats) row.capacity = seats
  }
  if (id) {
    const { error } = await supabase.from('reg_events').update(row).eq('id', id)
    if (error) return { error: dbError(error) }
    const { data: promoted } = await supabase.rpc('promote_waitlist', { p_reg_event: id })
    for (const p of (promoted ?? []) as string[]) await sendRegistrationEmail(p, 'promoted')
    revalidatePath(`/registrations/${id}`)
    return { ok: `Запазено${promoted?.length ? `. От списъка на изчакване получиха място: ${promoted.length}` : ''}` }
  }
  let slug = str(fd, 'slug') ? slugify(str(fd, 'slug')!) : slugify(title)
  if (slug.length < 3) slug = slug + '-reg'
  const { data: exists } = await supabase.from('reg_events').select('id').eq('slug', slug).maybeSingle()
  if (exists) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`
  const { data, error } = await supabase.from('reg_events').insert({ ...row, slug, created_by: me.id }).select('id').single()
  if (error) return { error: dbError(error) }
  redirect(`/registrations/${data.id}`)
}

export async function staffCancel(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('staff_cancel_registration', { p_id: str(fd, 'id') })
  if (error) return { error: dbError(error) }
  if (data?.promoted) await sendRegistrationEmail(data.promoted, 'promoted')
  revalidatePath(`/registrations/${str(fd, 'reg_event_id')}`)
  return { ok: data?.promoted ? 'Отказано. Първият от списъка на изчакване получи мястото и имейл.' : 'Отказано' }
}

export async function toggleCheckin(_: unknown, fd: FormData): Promise<Result> {
  const me = await requireMe()
  const supabase = await createClient()
  const on = fd.get('on') === 'true'
  const { error } = await supabase.from('registrations').update({ checked_in_at: on ? new Date().toISOString() : null, checked_in_by: on ? me.id : null }).eq('id', str(fd, 'id')!)
  if (error) return { error: dbError(error) }
  revalidatePath(`/registrations/${str(fd, 'reg_event_id')}`)
  return { ok: on ? 'Отбелязан вход' : 'Премахнат вход' }
}

export async function resendEmail(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { data: r } = await supabase.from('registrations').select('id, status').eq('id', str(fd, 'id')!).single()
  if (!r || r.status === 'cancelled') return { error: 'Регистрацията е отказана' }
  await sendRegistrationEmail(r.id, r.status === 'waitlist' ? 'waitlist' : 'confirmed')
  return { ok: 'Имейлът е изпратен отново' }
}

export async function staffRegister(_: unknown, fd: FormData): Promise<Result> {
  await requireMe()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('public_register', {
    p_slug: str(fd, 'slug'), p_first_name: str(fd, 'first_name'), p_last_name: str(fd, 'last_name'), p_email: str(fd, 'email'),
    p_phone: str(fd, 'phone'), p_answers: {}, p_seat_row: num(fd, 'seat_row'), p_seat_number: num(fd, 'seat_number'),
  })
  if (error) return { error: dbError(error) }
  await sendRegistrationEmail(data.id, data.status === 'waitlist' ? 'waitlist' : 'confirmed')
  revalidatePath(`/registrations/${str(fd, 'reg_event_id')}`)
  return { ok: data.status === 'waitlist' ? 'Добавен в списъка на изчакване' : 'Регистриран' }
}

export async function scanCode(code: string, regEventId: string) {
  await requireMe()
  const supabase = await createClient()
  const token = code.trim().split('/').pop() ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { ok: false, message: 'Невалиден QR код' }
  const { data: reg } = await supabase.from('registrations').select('reg_event_id, first_name, last_name, reg_events(title)').eq('qr_token', token).maybeSingle()
  if (!reg) return { ok: false, message: 'Непознат билет' }
  if (reg.reg_event_id !== regEventId) return { ok: false, message: 'Билетът е за друго събитие', name: `${reg.first_name} ${reg.last_name}`, title: (reg.reg_events as any)?.title }
  const { data, error } = await supabase.rpc('checkin_registration', { p_qr: token })
  if (error) return { ok: false, message: dbError(error) }
  return data as { ok: boolean; message: string; name?: string; title?: string; seat_row?: number; seat_number?: number }
}

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ActionForm, SubmitButton } from '@/components/forms'
import { SeatPicker } from '@/components/seat-picker'
import { fmtDate, fmtTime } from '@/lib/format'
import { publicRegister } from '../actions'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('reg_events').select('title, description').eq('slug', slug).eq('is_published', true).maybeSingle()
  return { title: data ? `Регистрация: ${data.title}` : 'Регистрация', description: data?.description ?? undefined }
}

export default async function PublicRegistration({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: e } = await supabase.from('reg_events').select('*').eq('slug', slug).eq('is_published', true).maybeSingle()
  if (!e) notFound()
  const [{ data: counts }, { data: taken }] = await Promise.all([
    supabase.rpc('reg_counts', { p_slug: slug }),
    e.use_seating ? supabase.rpc('reg_taken_seats', { p_slug: slug }) : Promise.resolve({ data: [] }),
  ])
  const c = (counts as any[])?.[0] ?? { confirmed: 0, waitlist: 0, capacity: e.capacity }
  const free = Math.max(e.capacity - c.confirmed, 0)
  const closed = !e.is_open || (e.closes_at && new Date(e.closes_at) < new Date())
  const questions = (e.questions ?? []) as any[]

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-br from-brand-600 to-violet-600 p-6 text-white">
          <h1 className="text-2xl font-bold">{e.title}</h1>
          {e.starts_at && <p className="mt-1 opacity-90">{fmtDate(e.starts_at, { weekday: 'long' })}, {fmtTime(e.starts_at)}</p>}
          {e.location && <p className="opacity-90">📍 {e.location}</p>}
          <p className="mt-3 inline-block rounded-full bg-white/20 px-3 py-1 text-sm font-medium">
            {closed ? 'Регистрацията е затворена' : free > 0 ? `Свободни места: ${free}` : 'Местата са заети – записване в списък на изчакване'}
          </p>
        </div>
        <div className="p-5 sm:p-6">
          {e.description && <p className="mb-5 whitespace-pre-line text-sm">{e.description}</p>}
          {closed ? <p className="text-center text-slate-500">Регистрацията за това събитие е затворена.</p> : (
            <ActionForm action={publicRegister} className="space-y-4">
              <input type="hidden" name="slug" value={slug} />
              <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
              <div className="grid gap-3 sm:grid-cols-2">
                <label><span className="label">Име *</span><input name="first_name" required className="input" autoComplete="given-name" /></label>
                <label><span className="label">Фамилия *</span><input name="last_name" required className="input" autoComplete="family-name" /></label>
                <label><span className="label">Имейл *</span><input name="email" type="email" required className="input" autoComplete="email" /></label>
                <label><span className="label">Телефон</span><input name="phone" type="tel" className="input" autoComplete="tel" /></label>
              </div>
              {questions.map((q) => (
                <label key={q.id} className="block">
                  {q.type !== 'checkbox' && <span className="label">{q.label}{q.required ? ' *' : ''}</span>}
                  {q.type === 'textarea' ? <textarea name={`q_${q.id}`} required={q.required} rows={3} className="input" />
                    : q.type === 'select' ? (
                      <select name={`q_${q.id}`} required={q.required} className="input" defaultValue="">
                        <option value="" disabled>— изберете —</option>
                        {(q.options ?? []).map((o: string) => <option key={o}>{o}</option>)}
                      </select>
                    ) : q.type === 'checkbox' ? (
                      <span className="flex items-center gap-2 text-sm"><input type="checkbox" name={`q_${q.id}`} value="да" required={q.required} />{q.label}{q.required ? ' *' : ''}</span>
                    ) : <input name={`q_${q.id}`} required={q.required} className="input" />}
                </label>
              ))}
              {e.use_seating && free > 0 && (
                <div>
                  <span className="label">Изберете място *</span>
                  <SeatPicker slug={slug} rows={e.seat_rows} perRow={e.seats_per_row} blocked={e.blocked_seats ?? []}
                    initialTaken={((taken ?? []) as any[]).map((t) => `${t.seat_row}-${t.seat_number}`)} />
                </div>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="consent" required className="mt-1" />
                <span>Съгласен/на съм данните ми да се използват само за организацията на това събитие (<Link href="/privacy" target="_blank" className="text-brand-600 underline">поверителност</Link>).</span>
              </label>
              <SubmitButton className="btn-primary w-full py-3 text-base" pendingText="Изпращане…">{free > 0 ? 'Регистрирай ме' : 'Запиши ме в списъка на изчакване'}</SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>
    </main>
  )
}

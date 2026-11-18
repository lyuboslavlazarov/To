import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Badge, Field } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { fmtShortDate, fmtTime, localDay } from '@/lib/format'
import { bookRoom, cancelBooking } from './actions'

export const metadata = { title: 'Помещения' }

export default async function RoomsPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const me = await requireMe()
  const sp = await searchParams
  const day = sp.day ?? localDay()
  const supabase = await createClient()
  const from = new Date(day + 'T00:00:00Z').getTime() - 3 * 3600e3
  const to = from + 7 * 864e5
  const [{ data: rooms }, { data: bookings }] = await Promise.all([
    supabase.from('rooms').select('*').eq('is_bookable', true).order('sort'),
    supabase.from('room_bookings').select('*, events(id, title), booker:profiles(first_name, last_name)').gte('ends_at', new Date(from).toISOString()).lte('starts_at', new Date(to).toISOString()).order('starts_at'),
  ])
  const canBook = me.can('rooms') || me.isLeader
  const days = Array.from({ length: 7 }, (_, i) => localDay(new Date(from + 3 * 3600e3 + i * 864e5 + 12 * 3600e3)))
  const prev = localDay(new Date(from - 4 * 864e5))
  const next = localDay(new Date(to))

  return (
    <>
      <PageHeader title="Помещения" subtitle="Заетост на залите и стаите. Резервациите не могат да се застъпват." />
      <div className="mb-3 flex items-center gap-2">
        <a href={`?day=${prev}`} className="btn-secondary btn-sm">← По-рано</a>
        <a href="?" className="btn-ghost btn-sm">Днес</a>
        <a href={`?day=${next}`} className="btn-secondary btn-sm">По-късно →</a>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {(rooms ?? []).map((r) => {
            const list = (bookings ?? []).filter((b) => b.room_id === r.id)
            return (
              <Card key={r.id} title={<>{r.name} {r.capacity ? <span className="muted text-xs font-normal">· {r.capacity} места</span> : null}</>}>
                {!list.length ? <p className="muted text-sm">Свободно през цялата седмица.</p> : (
                  <ul className="space-y-1 text-sm">
                    {days.map((d) => {
                      const dl = list.filter((b) => localDay(b.starts_at) === d)
                      if (!dl.length) return null
                      return dl.map((b: any) => (
                        <li key={b.id} className="flex items-center gap-2">
                          <span className="w-28 shrink-0 text-xs font-medium text-brand-600">{fmtShortDate(b.starts_at)}</span>
                          <span className="muted w-24 shrink-0 text-xs">{fmtTime(b.starts_at)}–{fmtTime(b.ends_at)}</span>
                          {b.events ? <a href={`/events/${b.events.id}`} className="flex-1 truncate hover:underline">{b.title}</a> : <span className="flex-1 truncate">{b.title}</span>}
                          {b.events ? <Badge color="blue">събитие</Badge> : <span className="muted hidden text-xs sm:inline">{fullName(b.booker)}</span>}
                          {!b.event_id && (b.booked_by === me.id || me.can('rooms')) && (
                            <ActionForm action={cancelBooking}><input type="hidden" name="id" value={b.id} /><SubmitButton className="btn-ghost btn-sm" confirm="Отмяна на резервацията?">✕</SubmitButton></ActionForm>
                          )}
                        </li>
                      ))
                    })}
                  </ul>
                )}
              </Card>
            )
          })}
        </div>
        {canBook && (
          <Card title="Нова резервация">
            <ActionForm action={bookRoom} className="space-y-3" resetOnOk>
              <Field label="Помещение"><select name="room_id" required className="input">{(rooms ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
              <Field label="За какво"><input name="title" required className="input" placeholder="Репетиция на хвалението" /></Field>
              <Field label="От"><input name="starts_at" type="datetime-local" required className="input" /></Field>
              <Field label="До"><input name="ends_at" type="datetime-local" required className="input" /></Field>
              <Field label="Екип (по избор)">
                <select name="team_id" className="input"><option value="">—</option>{me.memberships.map((m) => <option key={m.team_id} value={m.team_id}>{m.team.name}</option>)}</select>
              </Field>
              <SubmitButton>Резервирай</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  )
}

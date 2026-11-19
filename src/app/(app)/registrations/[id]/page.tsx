import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Badge, Stat, Empty, statusColor } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { RegEventForm } from '@/components/reg-event-form'
import { LiveRefresh } from '@/components/live-refresh'
import { qrDataUrl } from '@/lib/registrations'
import { fmtDateTime, STATUS_LABEL } from '@/lib/format'
import { staffCancel, toggleCheckin, resendEmail, staffRegister } from '../actions'

export default async function RegManage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; s?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const me = await requireMe()
  if (!me.can('registrations')) redirect('/')
  const supabase = await createClient()
  const { data: e } = await supabase.from('reg_events').select('*').eq('id', id).maybeSingle()
  if (!e) notFound()
  const [{ data: regs }, { data: events }, { data: rooms }] = await Promise.all([
    supabase.from('registrations').select('*').eq('reg_event_id', id).order('created_at'),
    supabase.from('events').select('id, title, starts_at').order('starts_at', { ascending: false }).limit(100),
    supabase.from('rooms').select('*').order('sort'),
  ])
  const all = regs ?? []
  const confirmed = all.filter((r) => r.status === 'confirmed')
  const waitlist = all.filter((r) => r.status === 'waitlist')
  const status = sp.s ?? 'active'
  const q = (sp.q ?? '').toLowerCase()
  const list = all
    .filter((r) => status === 'all' || (status === 'active' ? r.status !== 'cancelled' : r.status === status))
    .filter((r) => !q || `${r.first_name} ${r.last_name} ${r.email} ${r.phone ?? ''}`.toLowerCase().includes(q))
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? ''
  const publicUrl = `${site}/r/${e.slug}`
  const qr = await qrDataUrl(publicUrl, 300)
  const seatOf = new Map(confirmed.filter((r) => r.seat_row).map((r) => [`${r.seat_row}-${r.seat_number}`, r]))
  const questions = (e.questions ?? []) as any[]

  return (
    <>
      <LiveRefresh table="registrations" filter={`reg_event_id=eq.${id}`} channel={`reg-${id}`} />
      <PageHeader back="/registrations" title={e.title} subtitle={e.starts_at ? fmtDateTime(e.starts_at) : undefined}
        actions={<>
          <Link href={`/registrations/${id}/scan`} className="btn-primary">📷 Сканиране на вход</Link>
          <a href={`/api/registrations/${id}/export?format=xlsx`} className="btn-secondary">⬇ Excel</a>
          <a href={`/api/registrations/${id}/export?format=csv`} className="btn-secondary">⬇ CSV</a>
        </>} />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Записани" value={`${confirmed.length} / ${e.capacity}`} tone={confirmed.length >= e.capacity ? 'warn' : 'default'} />
        <Stat label="Свободни" value={Math.max(e.capacity - confirmed.length, 0)} />
        <Stat label="Списък на изчакване" value={waitlist.length} tone={waitlist.length ? 'warn' : 'default'} />
        <Stat label="Влезли" value={confirmed.filter((r) => r.checked_in_at).length} tone="ok" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <form className="mb-3 flex flex-wrap gap-2">
              <input name="q" defaultValue={sp.q} placeholder="Търсене по име, имейл, телефон…" className="input flex-1" />
              <select name="s" defaultValue={status} className="input w-auto">
                <option value="active">Активни</option><option value="confirmed">Потвърдени</option><option value="waitlist">Изчакване</option>
                <option value="cancelled">Отказани</option><option value="all">Всички</option>
              </select>
              <button className="btn-secondary">Търси</button>
            </form>
            {!list.length ? <Empty>Няма регистрирани.</Empty> : (
              <div className="-mx-4 overflow-x-auto sm:mx-0">
                <table className="table">
                  <thead><tr><th>Име</th><th>Контакт</th>{e.use_seating && <th>Място</th>}<th>Статус</th><th>Вход</th><th></th></tr></thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td className="font-medium">{r.first_name} {r.last_name}
                          {questions.length > 0 && <div className="muted text-xs">{questions.map((qq) => r.answers?.[qq.id] ? `${qq.label}: ${r.answers[qq.id]}` : null).filter(Boolean).join(' · ')}</div>}
                        </td>
                        <td className="text-xs"><div>{r.email}</div><div className="muted">{r.phone}</div></td>
                        {e.use_seating && <td>{r.seat_row ? `${r.seat_row}-${r.seat_number}` : '—'}</td>}
                        <td><Badge color={statusColor(r.status)}>{STATUS_LABEL[r.status]}{r.status === 'waitlist' ? ` №${waitlist.indexOf(r) + 1}` : ''}</Badge>{r.promoted_at && <div className="muted text-[10px]">от изчакване</div>}</td>
                        <td>
                          {r.status === 'confirmed' && (
                            <ActionForm action={toggleCheckin}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="reg_event_id" value={id} /><input type="hidden" name="on" value={r.checked_in_at ? 'false' : 'true'} />
                              <SubmitButton className={`btn-sm ${r.checked_in_at ? 'btn-success' : 'btn-secondary'}`} pendingText="…">{r.checked_in_at ? '✓' : 'Вход'}</SubmitButton></ActionForm>
                          )}
                        </td>
                        <td className="whitespace-nowrap">
                          {r.status !== 'cancelled' && (
                            <span className="flex gap-1">
                              <ActionForm action={resendEmail}><input type="hidden" name="id" value={r.id} /><SubmitButton className="btn-ghost btn-sm" pendingText="…">✉</SubmitButton></ActionForm>
                              <ActionForm action={staffCancel}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="reg_event_id" value={id} />
                                <SubmitButton className="btn-ghost btn-sm text-rose-600" confirm={`Да откажа ли регистрацията на ${r.first_name}?`} pendingText="…">✕</SubmitButton></ActionForm>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {e.use_seating && e.seat_rows && (
            <Card title="Схема на залата">
              <div className="overflow-x-auto">
                <div className="mx-auto mb-3 w-2/3 rounded-b-xl bg-slate-300 py-0.5 text-center text-[10px] font-semibold dark:bg-slate-700">СЦЕНА</div>
                {Array.from({ length: e.seat_rows }, (_, r) => (
                  <div key={r} className="mb-0.5 flex justify-center gap-0.5">
                    {Array.from({ length: e.seats_per_row }, (_, n) => {
                      const key = `${r + 1}-${n + 1}`
                      const who = seatOf.get(key)
                      const blocked = (e.blocked_seats ?? []).includes(key)
                      return <div key={key} title={who ? `${key}: ${who.first_name} ${who.last_name}` : key}
                        className={`h-4 w-4 rounded-t ${blocked ? 'invisible' : who ? (who.checked_in_at ? 'bg-emerald-500' : 'bg-brand-500') : 'bg-slate-200 dark:bg-slate-700'}`} />
                    })}
                  </div>
                ))}
              </div>
              <p className="muted mt-2 text-xs">Синьо – заето · зелено – влязъл · сиво – свободно. Задръжте курсора върху място, за да видите името.</p>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Публична страница">
            <a href={publicUrl} target="_blank" className="block break-all text-sm text-brand-600 underline">{publicUrl}</a>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR към регистрацията" className="mx-auto mt-3 w-40 rounded-lg bg-white p-1" />
            <p className="muted mt-1 text-center text-xs">QR код за плакати и съобщения</p>
          </Card>
          <Card title="Ръчно добавяне">
            <ActionForm action={staffRegister} className="space-y-2" resetOnOk>
              <input type="hidden" name="slug" value={e.slug} /><input type="hidden" name="reg_event_id" value={id} />
              <div className="grid grid-cols-2 gap-2"><input name="first_name" placeholder="Име" required className="input" /><input name="last_name" placeholder="Фамилия" required className="input" /></div>
              <input name="email" type="email" placeholder="Имейл" required className="input" />
              <input name="phone" placeholder="Телефон" className="input" />
              {e.use_seating && <div className="grid grid-cols-2 gap-2"><input name="seat_row" type="number" placeholder="Ред" className="input" /><input name="seat_number" type="number" placeholder="Място" className="input" /></div>}
              <SubmitButton className="btn-secondary btn-sm">Добави</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Настройки">
            <details><summary className="cursor-pointer text-sm text-brand-600">Редактирай регистрацията</summary>
              <div className="mt-3"><RegEventForm e={e} events={events ?? []} rooms={rooms ?? []} /></div>
            </details>
            <p className="muted mt-2 text-xs">Ако увеличите капацитета, чакащите получават места автоматично и имейл.</p>
          </Card>
        </div>
      </div>
    </>
  )
}

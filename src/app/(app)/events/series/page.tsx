import { redirect } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getStructure } from '@/lib/data'
import { PageHeader, Card, Field, Empty } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { saveSeries, generateSeries, deleteSeries } from '../actions'

const DAYS = ['', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота', 'неделя']

export default async function SeriesPage() {
  const me = await requireMe()
  if (!me.can('events')) redirect('/events')
  const supabase = await createClient()
  const [{ data: series }, { data: rooms }, depts] = await Promise.all([
    supabase.from('event_series').select('*, rooms(name), series_needs(needed, positions(name, teams(name)))').order('weekday'),
    supabase.from('rooms').select('id, name').order('sort'),
    getStructure(supabase),
  ])
  return (
    <>
      <PageHeader back="/events" title="Повтарящи се събития" subtitle="Напр. всяка неделя в 10:30. Събитията се създават предварително, за да могат доброволците да отбелязват кога са свободни." />
      <div className="space-y-3">
        {!series?.length && <Empty>Няма повтарящи се събития.</Empty>}
        {(series ?? []).map((s: any) => (
          <Card key={s.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{s.title}</div>
                <div className="muted text-sm">Всеки {s.interval_weeks > 1 ? `${s.interval_weeks}-и ` : ''}{DAYS[s.weekday]} в {s.start_time.slice(0, 5)} · {s.duration_minutes} мин.{s.rooms ? ` · ${s.rooms.name}` : ''}</div>
                <div className="muted mt-1 text-xs">{(s.series_needs ?? []).map((n: any) => `${n.positions?.teams?.name}: ${n.positions?.name}×${n.needed}`).join(' · ')}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <ActionForm action={generateSeries} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={s.id} />
                  <select name="weeks" className="input w-auto py-1.5" defaultValue="12"><option value="4">4 седм.</option><option value="8">8 седм.</option><option value="12">12 седм.</option><option value="26">6 мес.</option></select>
                  <SubmitButton className="btn-secondary btn-sm">Създай напред</SubmitButton>
                </ActionForm>
                <ActionForm action={deleteSeries} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={s.id} />
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="with_events" />и бъдещите събития</label>
                  <SubmitButton className="btn-ghost btn-sm text-rose-600" confirm="Да изтрия ли серията?">Изтрий</SubmitButton>
                </ActionForm>
              </div>
            </div>
          </Card>
        ))}
        <Card title="Нова серия">
          <ActionForm action={saveSeries} className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3"><Field label="Заглавие"><input name="title" required className="input" placeholder="Неделно събиране" /></Field></div>
            <Field label="Ден"><select name="weekday" className="input" defaultValue="7">{DAYS.slice(1).map((d, i) => <option key={i} value={i + 1}>{d}</option>)}</select></Field>
            <Field label="Час"><input name="start_time" type="time" required defaultValue="10:30" className="input" /></Field>
            <Field label="Продължителност (мин.)"><input name="duration_minutes" type="number" defaultValue={120} className="input" /></Field>
            <Field label="На всеки (седмици)"><input name="interval_weeks" type="number" min={1} max={8} defaultValue={1} className="input" /></Field>
            <Field label="От дата"><input name="starts_on" type="date" className="input" defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
            <Field label="До дата (по избор)"><input name="ends_on" type="date" className="input" /></Field>
            <Field label="Помещение"><select name="room_id" className="input"><option value="">— без —</option>{(rooms ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
            <Field label="Видимост"><select name="visibility" className="input"><option value="all">Всички</option><option value="teams">Участващите екипи</option><option value="leadership">Ръководството</option></select></Field>
            <Field label="Създай събития за"><select name="generate_weeks" className="input" defaultValue="12"><option value="4">4 седмици</option><option value="8">8 седмици</option><option value="12">12 седмици</option><option value="26">6 месеца</option></select></Field>
            <details className="sm:col-span-3">
              <summary className="cursor-pointer text-sm font-medium text-brand-600">Нужни позиции всяка седмица</summary>
              <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                {depts.flatMap((d) => d.teams).map((t) => (
                  <div key={t.id}><div className="font-medium">{t.name}</div>
                    <div className="flex flex-wrap gap-x-3">{t.positions.map((p) => <label key={p.id} className="flex items-center gap-1"><input type="checkbox" name="positions" value={p.id} />{p.name}</label>)}</div>
                  </div>
                ))}
              </div>
            </details>
            <div className="sm:col-span-3"><SubmitButton>Създай серията</SubmitButton></div>
          </ActionForm>
        </Card>
      </div>
    </>
  )
}

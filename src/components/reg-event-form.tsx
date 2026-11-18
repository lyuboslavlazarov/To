import { Field } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { QuestionsEditor } from '@/components/questions-editor'
import { toLocalInput } from '@/lib/format'
import { saveRegEvent } from '@/app/(app)/registrations/actions'

export function RegEventForm({ e, events, rooms }: { e?: any; events: any[]; rooms: any[] }) {
  const hall = rooms.find((r) => r.seat_rows)
  return (
    <ActionForm action={saveRegEvent} className="grid gap-3 sm:grid-cols-2">
      {e && <input type="hidden" name="id" value={e.id} />}
      <div className="sm:col-span-2"><Field label="Заглавие"><input name="title" defaultValue={e?.title} required className="input" /></Field></div>
      {!e && <Field label="Адрес на страницата (по избор)" hint="латиница, напр. konferencia-2026"><input name="slug" className="input" pattern="[a-z0-9\-]*" /></Field>}
      <Field label="Свързано събитие от календара">
        <select name="event_id" defaultValue={e?.event_id ?? ''} className="input">
          <option value="">— няма —</option>
          {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title} ({new Date(ev.starts_at).toLocaleDateString('bg-BG')})</option>)}
        </select>
      </Field>
      <Field label="Начало"><input name="starts_at" type="datetime-local" defaultValue={toLocalInput(e?.starts_at)} className="input" /></Field>
      <Field label="Място (адрес)"><input name="location" defaultValue={e?.location ?? ''} className="input" /></Field>
      <Field label="Капацитет (брой места)"><input name="capacity" type="number" min={0} defaultValue={e?.capacity ?? hall?.capacity ?? 100} className="input" /></Field>
      <Field label="Регистрацията се затваря на (по избор)"><input name="closes_at" type="datetime-local" defaultValue={toLocalInput(e?.closes_at)} className="input" /></Field>
      <div className="sm:col-span-2"><Field label="Описание"><textarea name="description" rows={3} defaultValue={e?.description ?? ''} className="input" /></Field></div>

      <fieldset className="rounded-xl border border-slate-200 p-3 sm:col-span-2 dark:border-slate-800">
        <label className="flex items-center gap-2 font-medium"><input type="checkbox" name="use_seating" defaultChecked={e?.use_seating} />Схема на залата – хората избират конкретно място</label>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Field label="Редове"><input name="seat_rows" type="number" min={1} max={60} defaultValue={e?.seat_rows ?? hall?.seat_rows ?? ''} className="input" /></Field>
          <Field label="Места на ред"><input name="seats_per_row" type="number" min={1} max={80} defaultValue={e?.seats_per_row ?? hall?.seats_per_row ?? ''} className="input" /></Field>
          <Field label="Неизползваеми места" hint="напр. 1-1 1-2 5-10 (ред-място)"><input name="blocked_seats" defaultValue={(e?.blocked_seats ?? []).join(' ')} className="input" /></Field>
        </div>
      </fieldset>

      <div className="sm:col-span-2"><span className="label">Допълнителни въпроси</span><QuestionsEditor initial={e?.questions ?? []} /></div>
      <div className="sm:col-span-2"><Field label="Текст в имейла с потвърждение (по избор)"><textarea name="confirmation_text" rows={2} defaultValue={e?.confirmation_text ?? ''} className="input" /></Field></div>
      <div className="flex flex-wrap gap-4 sm:col-span-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_published" defaultChecked={e?.is_published ?? true} />Публикувана (страницата е достъпна)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_open" defaultChecked={e?.is_open ?? true} />Отворена за записване</label>
      </div>
      <div className="sm:col-span-2"><SubmitButton>{e ? 'Запази' : 'Създай регистрацията'}</SubmitButton></div>
    </ActionForm>
  )
}

import { Field } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { toLocalInput } from '@/lib/format'
import { saveEvent } from '@/app/(app)/events/actions'
import type { Dept } from '@/lib/data'

export function EventForm({ ev, rooms, depts }: { ev?: any; rooms: any[]; depts?: Dept[] }) {
  const start = ev?.starts_at ?? null
  return (
    <ActionForm action={saveEvent} className="grid gap-3 sm:grid-cols-2">
      {ev && <input type="hidden" name="id" value={ev.id} />}
      <div className="sm:col-span-2"><Field label="Заглавие"><input name="title" defaultValue={ev?.title} required className="input" /></Field></div>
      <Field label="Начало"><input name="starts_at" type="datetime-local" defaultValue={toLocalInput(start)} required className="input" /></Field>
      <Field label="Край"><input name="ends_at" type="datetime-local" defaultValue={toLocalInput(ev?.ends_at)} required className="input" /></Field>
      <Field label="Помещение (резервира се автоматично)">
        <select name="room_id" defaultValue={ev?.room_id ?? ''} className="input">
          <option value="">— без —</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      <Field label="Видимост в календара">
        <select name="visibility" defaultValue={ev?.visibility ?? 'all'} className="input">
          <option value="all">Всички</option>
          <option value="teams">Само участващите екипи</option>
          <option value="leadership">Само ръководството</option>
        </select>
      </Field>
      <div className="sm:col-span-2"><Field label="Описание"><textarea name="description" rows={3} defaultValue={ev?.description ?? ''} className="input" /></Field></div>
      {depts && (
        <details className="sm:col-span-2">
          <summary className="cursor-pointer text-sm font-medium text-brand-600">Нужни позиции (по избор – може и после)</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {depts.map((d) => (
              <fieldset key={d.id} className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
                <legend className="px-1 text-xs font-semibold" style={{ color: d.color }}>{d.name}</legend>
                {d.teams.map((t) => (
                  <div key={t.id} className="mb-1">
                    <div className="font-medium">{t.name}</div>
                    <div className="flex flex-wrap gap-x-3">
                      {t.positions.map((p) => <label key={p.id} className="flex items-center gap-1"><input type="checkbox" name="positions" value={p.id} />{p.name}</label>)}
                    </div>
                  </div>
                ))}
              </fieldset>
            ))}
          </div>
        </details>
      )}
      <div className="sm:col-span-2"><SubmitButton>{ev ? 'Запази' : 'Създай събитието'}</SubmitButton></div>
    </ActionForm>
  )
}

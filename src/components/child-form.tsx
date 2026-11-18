import { Field } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { saveChild } from '@/app/(app)/kids/actions'

export function ChildForm({ child, care, groups, canCare, isNew }: { child?: any; care?: any; groups: any[]; canCare: boolean; isNew?: boolean }) {
  return (
    <ActionForm action={saveChild} className="grid gap-3 sm:grid-cols-2">
      {child && <input type="hidden" name="id" value={child.id} />}
      <Field label="Име"><input name="first_name" defaultValue={child?.first_name} required className="input" /></Field>
      <Field label="Фамилия"><input name="last_name" defaultValue={child?.last_name} required className="input" /></Field>
      <Field label="Дата на раждане"><input name="birthdate" type="date" defaultValue={child?.birthdate ?? ''} className="input" /></Field>
      <Field label="Група" hint="Празно = автоматично по възрастта">
        <select name="group_team_id" defaultValue={child?.group_team_id ?? ''} className="input">
          <option value="">Автоматично</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </Field>
      {(canCare || isNew) && (
        <fieldset className="rounded-xl border border-amber-300 bg-amber-50/50 p-3 sm:col-span-2 dark:border-amber-800 dark:bg-amber-900/10">
          <legend className="px-1 text-sm font-semibold">🔒 Здравни данни (виждат ги само учителите на групата)</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Алергии"><input name="allergies" defaultValue={care?.allergies ?? ''} className="input" placeholder="напр. фъстъци, мляко" /></Field>
            <Field label="Здравни бележки"><input name="medical_notes" defaultValue={care?.medical_notes ?? ''} className="input" placeholder="лекарства, състояния" /></Field>
            <div className="sm:col-span-2"><Field label="Други бележки за учителите"><textarea name="care_notes" rows={2} defaultValue={care?.notes ?? ''} className="input" /></Field></div>
          </div>
        </fieldset>
      )}
      {isNew && (
        <fieldset className="rounded-xl border border-slate-200 p-3 sm:col-span-2 dark:border-slate-800">
          <legend className="px-1 text-sm font-semibold">Родител / настойник</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Име"><input name="g_first_name" required className="input" /></Field>
            <Field label="Фамилия"><input name="g_last_name" className="input" /></Field>
            <Field label="Телефон"><input name="g_phone" type="tel" required className="input" /></Field>
            <Field label="Имейл"><input name="g_email" type="email" className="input" /></Field>
            <Field label="Връзка"><select name="g_relationship" className="input"><option>майка</option><option>баща</option><option>баба</option><option>дядо</option><option>настойник</option><option>друг</option></select></Field>
          </div>
        </fieldset>
      )}
      <div className="space-y-2 text-sm sm:col-span-2">
        <label className="flex items-start gap-2"><input type="checkbox" name="photo_consent" defaultChecked={child?.photo_consent} className="mt-1" />Родителят разрешава снимки на детето в материали на организацията</label>
        {(isNew || !child?.consent_at) && (
          <label className="flex items-start gap-2"><input type="checkbox" name="consent" required={isNew} className="mt-1" />
            <span><b>Родителят дава съгласие</b> данните на детето да се обработват за целите на детското служение (GDPR).</span></label>
        )}
      </div>
      <div className="sm:col-span-2"><SubmitButton>{isNew ? 'Добави детето' : 'Запази'}</SubmitButton></div>
    </ActionForm>
  )
}

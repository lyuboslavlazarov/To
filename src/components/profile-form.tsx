import { Field } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { saveProfile } from '@/app/(app)/people/actions'

export function ProfileForm({ p }: { p: any }) {
  return (
    <ActionForm action={saveProfile} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={p.id} />
      <Field label="Име"><input name="first_name" defaultValue={p.first_name} required className="input" /></Field>
      <Field label="Фамилия"><input name="last_name" defaultValue={p.last_name} required className="input" /></Field>
      <Field label="Телефон"><input name="phone" type="tel" defaultValue={p.phone ?? ''} className="input" /></Field>
      <Field label="Рожден ден"><input name="birthday" type="date" defaultValue={p.birthday ?? ''} className="input" /></Field>
      <Field label="Размер тениска">
        <select name="tshirt_size" defaultValue={p.tshirt_size ?? ''} className="input">
          <option value="">—</option>
          {['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Умения (разделени със запетая)"><input name="skills" defaultValue={(p.skills ?? []).join(', ')} className="input" placeholder="китара, монтаж, фотография" /></Field>
      <div className="sm:col-span-2"><SubmitButton>Запази</SubmitButton></div>
    </ActionForm>
  )
}

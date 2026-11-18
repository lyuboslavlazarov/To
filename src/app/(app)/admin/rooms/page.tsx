import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Field } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { AdminTabs } from '../tabs'
import { saveRoom, deleteRow } from '../actions'

function RoomForm({ r }: { r?: any }) {
  return (
    <ActionForm action={saveRoom} className="grid gap-3 sm:grid-cols-6" resetOnOk={!r}>
      {r && <input type="hidden" name="id" value={r.id} />}
      <div className="sm:col-span-2"><Field label="Име"><input name="name" defaultValue={r?.name} required className="input" /></Field></div>
      <Field label="Места"><input name="capacity" type="number" defaultValue={r?.capacity ?? ''} className="input" /></Field>
      <Field label="Редове"><input name="seat_rows" type="number" defaultValue={r?.seat_rows ?? ''} className="input" /></Field>
      <Field label="Места на ред"><input name="seats_per_row" type="number" defaultValue={r?.seats_per_row ?? ''} className="input" /></Field>
      <label className="flex items-end gap-2 pb-3 text-sm"><input type="checkbox" name="is_bookable" defaultChecked={r ? r.is_bookable : true} />За резервации</label>
      <div className="sm:col-span-6 flex gap-2"><SubmitButton className="btn-primary btn-sm">{r ? 'Запази' : 'Добави помещение'}</SubmitButton></div>
    </ActionForm>
  )
}

export default async function RoomsAdmin() {
  await requireAdmin()
  const { data: rooms } = await (await createClient()).from('rooms').select('*').order('sort').order('name')
  return (
    <>
      <PageHeader title="Администрация" subtitle="Залите и помещенията. Редовете × местата се ползват за схемата при регистрации." />
      <AdminTabs active="rooms" />
      <div className="space-y-3">
        {(rooms ?? []).map((r) => (
          <Card key={r.id}>
            <RoomForm r={r} />
            <ActionForm action={deleteRow} className="mt-1">
              <input type="hidden" name="table" value="rooms" /><input type="hidden" name="id" value={r.id} />
              <SubmitButton className="btn-ghost btn-sm text-rose-600" confirm="Да изтрия ли помещението?">Изтрий</SubmitButton>
            </ActionForm>
          </Card>
        ))}
        <Card title="Ново помещение"><RoomForm /></Card>
      </div>
    </>
  )
}

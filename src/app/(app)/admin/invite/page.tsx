import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getStructure } from '@/lib/data'
import { PageHeader, Card, Field } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { TeamPicker } from '@/components/team-picker'
import { AdminTabs } from '../tabs'
import { invitePerson } from '../actions'

export default async function InvitePage() {
  await requireAdmin()
  const depts = await getStructure(await createClient())
  return (
    <>
      <PageHeader title="Администрация" />
      <AdminTabs active="invite" />
      <Card title="Добави нов човек">
        <p className="muted mb-4 text-sm">Човекът получава имейл с покана и линк за вход. Профилът е одобрен веднага.</p>
        <ActionForm action={invitePerson} className="space-y-4" resetOnOk>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Име"><input name="first_name" required className="input" /></Field>
            <Field label="Фамилия"><input name="last_name" required className="input" /></Field>
            <Field label="Имейл"><input name="email" type="email" required className="input" /></Field>
            <Field label="Телефон"><input name="phone" type="tel" className="input" /></Field>
            <Field label="Роля">
              <select name="role" className="input" defaultValue="member">
                <option value="member">Член / доброволец</option>
                <option value="leadership">Ръководство</option>
                <option value="admin">Администратор</option>
              </select>
            </Field>
          </div>
          <div><span className="label">Служения</span><TeamPicker depts={depts} /></div>
          <SubmitButton>Изпрати покана</SubmitButton>
        </ActionForm>
      </Card>
    </>
  )
}

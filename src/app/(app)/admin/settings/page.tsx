import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Field } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { AdminTabs } from '../tabs'
import { saveSettings } from '../actions'

export default async function SettingsPage() {
  await requireAdmin()
  const { data } = await (await createClient()).from('app_settings').select('*')
  const s = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
  return (
    <>
      <PageHeader title="Администрация" />
      <AdminTabs active="settings" />
      <Card title="Общи настройки">
        <ActionForm action={saveSettings} className="max-w-lg space-y-4">
          <Field label="Име на организацията"><input name="org_name" defaultValue={s.org_name ?? ''} className="input" /></Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="require_mfa_for_staff" defaultChecked={s.require_mfa_for_staff !== false} className="mt-1" />
            <span><b>Задължителна двуфакторна защита (2FA)</b> за администратора и ръководството. Силно препоръчително заради личните данни на децата.</span>
          </label>
          <SubmitButton>Запази</SubmitButton>
        </ActionForm>
      </Card>
    </>
  )
}

import { requireAdmin, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getStructure } from '@/lib/data'
import { PageHeader, Card, Empty, Avatar } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { TeamPicker } from '@/components/team-picker'
import { fmtDateTime } from '@/lib/format'
import { AdminTabs } from './tabs'
import { approvePerson, rejectPerson } from './actions'

export const metadata = { title: 'Администрация' }

export default async function AdminPage() {
  await requireAdmin()
  const supabase = await createClient()
  const [{ data: pending }, depts] = await Promise.all([
    supabase.from('profiles').select('*').eq('status', 'pending').order('created_at'),
    getStructure(supabase),
  ])
  return (
    <>
      <PageHeader title="Администрация" subtitle="Нови хора, структура, права и настройки" />
      <AdminTabs active="approvals" />
      <h2 className="mb-3 text-lg font-semibold">Чакат одобрение ({pending?.length ?? 0})</h2>
      {!pending?.length ? (
        <Empty>Няма нови регистрации.</Empty>
      ) : (
        <div className="space-y-4">
          {pending.map((p) => (
            <Card key={p.id}>
              <div className="mb-3 flex items-center gap-3">
                <Avatar p={p} size={44} />
                <div className="min-w-0">
                  <div className="font-semibold">{fullName(p)}</div>
                  <div className="muted text-sm">{p.email}{p.phone ? ` · ${p.phone}` : ''}</div>
                  <div className="muted text-xs">Регистриран: {fmtDateTime(p.created_at)} {p.gdpr_consent_at ? '· съгласие за данните ✓' : ''}</div>
                </div>
              </div>
              <ActionForm action={approvePerson} className="space-y-3">
                <input type="hidden" name="id" value={p.id} />
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-brand-600">Добави в служения</summary>
                  <div className="mt-3"><TeamPicker depts={depts} /></div>
                </details>
                <div className="flex flex-wrap items-center gap-2">
                  <select name="role" className="input w-auto" defaultValue="member">
                    <option value="member">Член / доброволец</option>
                    <option value="leadership">Ръководство</option>
                    <option value="admin">Администратор</option>
                  </select>
                  <SubmitButton className="btn-success">Одобри</SubmitButton>
                </div>
              </ActionForm>
              <ActionForm action={rejectPerson} className="mt-2">
                <input type="hidden" name="id" value={p.id} />
                <SubmitButton className="btn-ghost btn-sm text-rose-600" confirm="Да отхвърля ли регистрацията?">Отхвърли</SubmitButton>
              </ActionForm>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

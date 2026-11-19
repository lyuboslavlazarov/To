import { requireAdmin, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Badge, Empty } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { fmtDateTime } from '@/lib/format'
import { AdminTabs } from '../tabs'
import { handleDataRequest } from '../actions'

export default async function GdprPage() {
  await requireAdmin()
  const { data: reqs } = await (await createClient()).from('data_requests').select('*, profile:profiles!data_requests_profile_id_fkey(first_name, last_name, email)').order('created_at', { ascending: false })
  return (
    <>
      <PageHeader title="Администрация" subtitle="Заявки по GDPR: право на достъп и право на изтриване („да бъдеш забравен“)." />
      <AdminTabs active="gdpr" />
      {!reqs?.length ? <Empty>Няма заявки.</Empty> : (
        <div className="space-y-3">
          {reqs.map((r: any) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-center gap-2">
                <b>{fullName(r.profile)}</b><span className="muted text-sm">{r.profile?.email}</span>
                <Badge color={r.kind === 'delete' ? 'red' : 'blue'}>{r.kind === 'delete' ? 'Изтриване' : 'Копие на данните'}</Badge>
                <Badge color={r.status === 'open' ? 'yellow' : 'green'}>{r.status === 'open' ? 'Отворена' : r.status === 'done' ? 'Изпълнена' : 'Отказана'}</Badge>
                <span className="muted ml-auto text-xs">{fmtDateTime(r.created_at)}</span>
              </div>
              {r.note && <p className="mt-2 text-sm">{r.note}</p>}
              {r.status === 'open' && (
                <ActionForm action={handleDataRequest} className="mt-3 flex flex-wrap gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  {r.kind === 'delete' && <SubmitButton name="decision" value="delete" className="btn-danger btn-sm" confirm="Профилът и всички лични данни ще бъдат изтрити окончателно. Продължаване?">Изтрий профила и данните</SubmitButton>}
                  <SubmitButton name="decision" value="done" className="btn-secondary btn-sm">Отбележи като изпълнена</SubmitButton>
                  <SubmitButton name="decision" value="reject" className="btn-ghost btn-sm">Откажи</SubmitButton>
                </ActionForm>
              )}
            </Card>
          ))}
        </div>
      )}
      <p className="muted mt-4 text-xs">Копие на данните човекът може да изтегли и сам от „Моят профил“. Сроковете по GDPR са до 1 месец.</p>
    </>
  )
}

import { notFound } from 'next/navigation'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Badge, statusColor } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { PhotoUpload } from '@/components/photo-upload'
import { fmtDateTime, toLocalInput, STATUS_LABEL } from '@/lib/format'
import { updateTask, deleteTask, setTaskPhoto } from '../actions'

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await requireMe()
  const supabase = await createClient()
  const { data: t } = await supabase.from('tasks').select('*, teams(id, name, department_id), assignee:profiles!tasks_assignee_id_fkey(first_name, last_name), author:profiles!tasks_created_by_fkey(first_name, last_name)').eq('id', id).maybeSingle()
  if (!t) notFound()
  const canManage = me.isStaff || (t.team_id && (me.ledTeamIds.includes(t.team_id) || me.ledDepartmentIds.includes(t.teams?.department_id)))
  const [{ data: members }, signed] = await Promise.all([
    t.team_id ? supabase.from('team_members').select('profiles(id, first_name, last_name)').eq('team_id', t.team_id) : Promise.resolve({ data: [] }),
    Promise.all([t.photo_path, t.proof_path].map(async (p) => (p ? (await supabase.storage.from('task-photos').createSignedUrl(p, 3600)).data?.signedUrl : null))),
  ])
  const folder = t.team_id ?? 'issues'
  return (
    <>
      <PageHeader back="/tasks" title={<>{t.is_issue ? '🔧 ' : ''}{t.title}</>} subtitle={<>{t.teams?.name ?? ''}{t.location ? ` · ${t.location}` : ''}</>}
        actions={<Badge color={statusColor(t.status)}>{STATUS_LABEL[t.status]}</Badge>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            {t.description && <p className="mb-3 whitespace-pre-line">{t.description}</p>}
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div><dt className="muted text-xs">Отговорник</dt><dd>{t.assignee ? fullName(t.assignee) : '—'}</dd></div>
              <div><dt className="muted text-xs">Срок</dt><dd>{t.due_at ? fmtDateTime(t.due_at) : '—'}</dd></div>
              <div><dt className="muted text-xs">Създадена от</dt><dd>{fullName(t.author)} · {fmtDateTime(t.created_at)}</dd></div>
              <div><dt className="muted text-xs">Приоритет</dt><dd>{t.priority === 1 ? 'Спешно' : t.priority === 3 ? 'Ниско' : 'Нормално'}</dd></div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {t.status !== 'in_progress' && t.status !== 'done' && <ActionForm action={updateTask}><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value="in_progress" /><SubmitButton className="btn-secondary">Започвам</SubmitButton></ActionForm>}
              {t.status !== 'done' && <ActionForm action={updateTask}><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value="done" /><SubmitButton className="btn-success">✓ Готово</SubmitButton></ActionForm>}
              {t.status === 'done' && <ActionForm action={updateTask}><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value="open" /><SubmitButton className="btn-ghost">Отвори отново</SubmitButton></ActionForm>}
            </div>
          </Card>
          <Card title="Снимки">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="muted mb-1 text-xs">{t.is_issue ? 'Снимка на проблема' : 'Снимка'}</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {signed[0] ? <a href={signed[0]} target="_blank"><img src={signed[0]} alt="" className="max-h-64 rounded-xl" /></a> : <PhotoUpload folder={folder} onUploaded={setTaskPhoto.bind(null, id, 'photo_path')} />}
              </div>
              <div>
                <div className="muted mb-1 text-xs">Доказателство за изпълнение</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {signed[1] ? <a href={signed[1]} target="_blank"><img src={signed[1]} alt="" className="max-h-64 rounded-xl" /></a> : <PhotoUpload folder={folder} label="📷 Снимка „след“" onUploaded={setTaskPhoto.bind(null, id, 'proof_path')} />}
              </div>
            </div>
          </Card>
        </div>
        {canManage && (
          <Card title="Управление">
            <ActionForm action={updateTask} className="space-y-3">
              <input type="hidden" name="id" value={id} />
              <label className="block"><span className="label">Отговорник</span>
                <select name="assignee_id" defaultValue={t.assignee_id ?? ''} className="input"><option value="">— без —</option>{(members ?? []).map((m: any) => <option key={m.profiles.id} value={m.profiles.id}>{fullName(m.profiles)}</option>)}</select>
              </label>
              <label className="block"><span className="label">Срок</span><input name="due_at" type="datetime-local" defaultValue={toLocalInput(t.due_at)} className="input" /></label>
              <SubmitButton className="btn-primary btn-sm">Запази</SubmitButton>
            </ActionForm>
            <ActionForm action={deleteTask} className="mt-3"><input type="hidden" name="id" value={id} /><SubmitButton className="btn-ghost btn-sm text-rose-600" confirm="Изтриване на задачата?">Изтрий</SubmitButton></ActionForm>
          </Card>
        )}
      </div>
    </>
  )
}

import { notFound } from 'next/navigation'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Badge } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { PhotoUpload } from '@/components/photo-upload'
import { fmtDateTime, fmtTime } from '@/lib/format'
import { toggleItem, setItemPhoto, assignChecklist } from '../../actions'

export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await requireMe()
  const supabase = await createClient()
  const { data: c } = await supabase.from('checklists').select('*, teams(id, name, department_id), assignee:profiles!checklists_assignee_id_fkey(first_name, last_name), checklist_items(*)').eq('id', id).maybeSingle()
  if (!c) notFound()
  const items = (c.checklist_items ?? []).sort((a: any, b: any) => a.sort - b.sort)
  const urls = new Map<string, string>()
  const withPhoto = items.filter((i: any) => i.photo_path)
  if (withPhoto.length) {
    const { data } = await supabase.storage.from('task-photos').createSignedUrls(withPhoto.map((i: any) => i.photo_path), 3600)
    for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
  }
  const canManage = me.isStaff || me.ledTeamIds.includes(c.team_id) || me.ledDepartmentIds.includes(c.teams?.department_id)
  const { data: members } = canManage ? await supabase.from('team_members').select('profiles(id, first_name, last_name)').eq('team_id', c.team_id) : { data: [] }
  const done = items.filter((i: any) => i.done_at).length
  return (
    <>
      <PageHeader back="/tasks?view=checklists" title={c.title} subtitle={<>{c.teams?.name} · до {fmtDateTime(c.due_at)}{c.assignee ? ` · ${fullName(c.assignee)}` : ''}</>}
        actions={c.completed_at ? <Badge color="green">✓ Завършен</Badge> : <Badge>{done}/{items.length}</Badge>} />
      <Card className="p-0">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((i: any) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 p-4">
              <ActionForm action={toggleItem}>
                <input type="hidden" name="id" value={i.id} /><input type="hidden" name="checklist_id" value={id} /><input type="hidden" name="done" value={i.done_at ? 'false' : 'true'} />
                <SubmitButton pendingText="…" className={`flex h-8 w-8 items-center justify-center rounded-lg border-2 text-lg ${i.done_at ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600'}`}>{i.done_at ? '✓' : ''}</SubmitButton>
              </ActionForm>
              <div className="min-w-0 flex-1">
                <div className={i.done_at ? 'line-through opacity-60' : ''}>{i.title}</div>
                {i.requires_photo && !i.photo_path && <div className="text-xs text-amber-600">Нужна е снимка, преди да отметнете</div>}
                {i.done_at && <div className="muted text-xs">{fmtTime(i.done_at)}</div>}
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {i.photo_path && urls.get(i.photo_path) ? <a href={urls.get(i.photo_path)} target="_blank"><img src={urls.get(i.photo_path)} alt="" className="h-12 w-12 rounded-lg object-cover" /></a>
                : <PhotoUpload folder={c.team_id} label="📷" onUploaded={setItemPhoto.bind(null, i.id, id)} />}
            </li>
          ))}
        </ul>
      </Card>
      {canManage && (
        <Card title="Отговорник" className="mt-4">
          <ActionForm action={assignChecklist} className="flex gap-2">
            <input type="hidden" name="id" value={id} />
            <select name="assignee_id" defaultValue={c.assignee_id ?? ''} className="input"><option value="">— без —</option>{(members ?? []).map((m: any) => <option key={m.profiles.id} value={m.profiles.id}>{fullName(m.profiles)}</option>)}</select>
            <SubmitButton className="btn-secondary">Запази</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  )
}

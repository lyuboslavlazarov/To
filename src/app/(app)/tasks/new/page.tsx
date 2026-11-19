import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getStructure } from '@/lib/data'
import { PageHeader, Card, Field } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { PhotoUpload } from '@/components/photo-upload'
import { createTask } from '../actions'

export default async function NewTask({ searchParams }: { searchParams: Promise<{ issue?: string; team?: string }> }) {
  const me = await requireMe()
  const sp = await searchParams
  const issue = !!sp.issue || (!me.isStaff && !me.isLeader)
  const supabase = await createClient()
  const depts = await getStructure(supabase)
  const building = depts.find((d) => d.slug === 'building')
  const defaultIssueTeam = building?.teams.find((t) => /поддръжка/i.test(t.name))?.id ?? building?.teams[0]?.id
  const ledTeams = depts.flatMap((d) => d.teams).filter((t) => me.isStaff || me.ledTeamIds.includes(t.id) || me.ledDepartmentIds.includes(t.department_id))
  const teamId = sp.team ?? (issue ? defaultIssueTeam : ledTeams[0]?.id)
  const { data: members } = !issue && teamId ? await supabase.from('team_members').select('profiles(id, first_name, last_name)').eq('team_id', teamId) : { data: [] }
  return (
    <>
      <PageHeader back="/tasks" title={issue ? '🔧 Сигнал за повреда' : 'Нова задача'} subtitle={issue ? 'Опишете проблема и добавете снимка – екипът по поддръжка ще бъде уведомен.' : undefined} />
      <Card>
        <ActionForm action={createTask} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="is_issue" value={issue ? 'true' : 'false'} />
          <div className="sm:col-span-2"><Field label={issue ? 'Какво не работи?' : 'Задача'}><input name="title" required className="input" placeholder={issue ? 'напр. Тече кранчето в кухнята' : ''} /></Field></div>
          <div className="sm:col-span-2"><Field label="Подробности"><textarea name="description" rows={3} className="input" /></Field></div>
          {issue && <Field label="Къде"><input name="location" className="input" placeholder="напр. Кухня, Детска стая 2" /></Field>}
          <Field label={issue ? 'До кой екип' : 'Екип'}>
            <select name="team_id" defaultValue={teamId} className="input">
              {(issue ? depts.flatMap((d) => d.teams) : ledTeams).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          {!issue && (
            <Field label="Отговорник">
              <select name="assignee_id" className="input"><option value="">— без —</option>{(members ?? []).map((m: any) => <option key={m.profiles.id} value={m.profiles.id}>{m.profiles.first_name} {m.profiles.last_name}</option>)}</select>
            </Field>
          )}
          {!issue && <Field label="Срок"><input name="due_at" type="datetime-local" className="input" /></Field>}
          <Field label="Приоритет"><select name="priority" defaultValue="2" className="input"><option value="1">Спешно</option><option value="2">Нормално</option><option value="3">Ниско</option></select></Field>
          {issue && <div className="sm:col-span-2"><PhotoUpload folder="issues" inputName="photo_path" label="📷 Добави снимка" /></div>}
          <div className="sm:col-span-2"><SubmitButton>{issue ? 'Изпрати сигнала' : 'Създай задачата'}</SubmitButton></div>
        </ActionForm>
      </Card>
    </>
  )
}

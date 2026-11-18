import { redirect } from 'next/navigation'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getStructure } from '@/lib/data'
import { PageHeader, Card, Field, Badge } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { saveTemplate, runTemplateNow, deleteTemplate } from '../actions'

const DAYS = ['', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота', 'неделя']
const REC: Record<string, string> = { none: 'Еднократен (ръчно)', daily: 'Всеки ден', weekly: 'Всяка седмица', monthly: 'Всеки месец' }

function TemplateForm({ t, teams, people }: { t?: any; teams: any[]; people: any[] }) {
  const items = (t?.checklist_template_items ?? []).sort((a: any, b: any) => a.sort - b.sort).map((i: any) => i.title + (i.requires_photo ? ' [снимка]' : '')).join('\n')
  return (
    <ActionForm action={saveTemplate} className="grid gap-3 sm:grid-cols-3">
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="sm:col-span-2"><Field label="Заглавие"><input name="title" defaultValue={t?.title} required className="input" /></Field></div>
      <Field label="Екип"><select name="team_id" defaultValue={t?.team_id} className="input">{teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="Повторение"><select name="recurrence" defaultValue={t?.recurrence ?? 'weekly'} className="input">{Object.entries(REC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Ден от седмицата"><select name="weekday" defaultValue={t?.weekday ?? 7} className="input">{DAYS.slice(1).map((d, i) => <option key={i} value={i + 1}>{d}</option>)}</select></Field>
      <Field label="Ден от месеца"><input name="month_day" type="number" min={1} max={28} defaultValue={t?.month_day ?? 1} className="input" /></Field>
      <Field label="Срок (час)"><input name="due_time" type="time" defaultValue={(t?.due_time ?? '18:00').slice(0, 5)} className="input" /></Field>
      <Field label="Отговорник по подразбиране"><select name="default_assignee_id" defaultValue={t?.default_assignee_id ?? ''} className="input"><option value="">— без —</option>{people.map((p) => <option key={p.id} value={p.id}>{fullName(p)}</option>)}</select></Field>
      <label className="flex items-end gap-2 pb-3 text-sm"><input type="hidden" name="is_active" value="false" /><input type="checkbox" name="is_active" value="on" defaultChecked={t?.is_active ?? true} />Активен</label>
      <div className="sm:col-span-3"><Field label="Точки (по една на ред; добавете „[снимка]“ накрая, ако се изисква снимка)"><textarea name="items" rows={5} defaultValue={items} className="input font-mono text-sm" /></Field></div>
      <div className="sm:col-span-3"><SubmitButton className="btn-primary btn-sm">{t ? 'Запази' : 'Създай шаблона'}</SubmitButton></div>
    </ActionForm>
  )
}

export default async function TemplatesPage() {
  const me = await requireMe()
  if (!me.isStaff && !me.isLeader) redirect('/tasks')
  const supabase = await createClient()
  const depts = await getStructure(supabase)
  const teams = depts.flatMap((d) => d.teams).filter((t) => me.isStaff || me.ledTeamIds.includes(t.id) || me.ledDepartmentIds.includes(t.department_id))
  const [{ data: tpls }, { data: members }] = await Promise.all([
    supabase.from('checklist_templates').select('*, teams(name), checklist_template_items(*)').in('team_id', teams.map((t) => t.id)).order('created_at'),
    supabase.from('team_members').select('profiles(id, first_name, last_name)').in('team_id', teams.map((t) => t.id)),
  ])
  const people = [...new Map((members ?? []).map((m: any) => [m.profiles.id, m.profiles])).values()]
  return (
    <>
      <PageHeader back="/tasks" title="Шаблони за чеклисти" subtitle="Повтарящи се чеклисти по екипи – създават се автоматично всеки ден/седмица/месец." />
      <div className="space-y-3">
        {(tpls ?? []).map((t: any) => (
          <Card key={t.id}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <b>{t.title}</b><Badge>{t.teams?.name}</Badge><Badge color="blue">{REC[t.recurrence]}{t.recurrence === 'weekly' ? `, ${DAYS[t.weekday ?? 1]}` : t.recurrence === 'monthly' ? `, ${t.month_day}-о число` : ''}</Badge>
              {!t.is_active && <Badge color="red">спрян</Badge>}
              <ActionForm action={runTemplateNow} className="ml-auto"><input type="hidden" name="id" value={t.id} /><SubmitButton className="btn-secondary btn-sm">Създай сега</SubmitButton></ActionForm>
              <ActionForm action={deleteTemplate}><input type="hidden" name="id" value={t.id} /><SubmitButton className="btn-ghost btn-sm text-rose-600" confirm="Изтриване на шаблона?">✕</SubmitButton></ActionForm>
            </div>
            <details><summary className="cursor-pointer text-sm text-brand-600">Редактирай ({t.checklist_template_items?.length ?? 0} точки)</summary><div className="mt-3"><TemplateForm t={t} teams={teams} people={people} /></div></details>
          </Card>
        ))}
        <Card title="Нов шаблон"><TemplateForm teams={teams} people={people} /></Card>
      </div>
    </>
  )
}

import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getStructure } from '@/lib/data'
import { PageHeader, Card, Badge, Empty, Field } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { fmtDateTime } from '@/lib/format'
import { sendAnnouncement, deleteAnnouncement } from './actions'

export const metadata = { title: 'Съобщения' }

export default async function MessagesPage() {
  const me = await requireMe()
  const supabase = await createClient()
  const [{ data: anns }, depts] = await Promise.all([
    supabase.from('announcements').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100),
    getStructure(supabase),
  ])
  const canAll = me.can('announcements')
  const leads = (t: any) => canAll || me.ledTeamIds.includes(t.id) || me.ledDepartmentIds.includes(t.department_id)
  const targets: { value: string; label: string; group: string }[] = []
  if (canAll) targets.push({ value: 'all:', label: 'Всички', group: 'Цялата организация' })
  for (const d of depts) {
    if (canAll || me.ledDepartmentIds.includes(d.id)) targets.push({ value: `department:${d.id}`, label: `Отдел: ${d.name}`, group: d.name })
    for (const t of d.teams) if (leads(t)) {
      targets.push({ value: `team:${t.id}`, label: `Екип: ${t.name}`, group: d.name })
      for (const p of t.positions) targets.push({ value: `position:${p.id}`, label: `${t.name} → ${p.name}`, group: d.name })
    }
  }
  const audLabel = (a: any) => {
    if (a.audience === 'all') return 'Всички'
    for (const d of depts) {
      if (a.audience === 'department' && d.id === a.audience_id) return d.name
      for (const t of d.teams) {
        if (a.audience === 'team' && t.id === a.audience_id) return t.name
        const p = t.positions.find((x) => x.id === a.audience_id)
        if (a.audience === 'position' && p) return `${t.name} → ${p.name}`
      }
    }
    return ''
  }
  const groups = [...new Set(targets.map((t) => t.group))]

  return (
    <>
      <PageHeader title="Съобщения" subtitle="Съобщения до всички, отдел, екип или позиция. Всеки вижда само тези, които са за него." />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {!anns?.length ? <Empty>Няма съобщения.</Empty> : anns.map((a) => (
            <Card key={a.id}>
              <div id={a.id} className="flex flex-wrap items-center gap-2">
                {a.pinned && <span>📌</span>}
                <h3 className="font-semibold">{a.title}</h3>
                <Badge color="blue">{audLabel(a)}</Badge>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm">{a.body}</p>
              <div className="muted mt-2 flex items-center gap-2 text-xs">
                {a.author_name} · {fmtDateTime(a.created_at)}
                {(a.author_id === me.id || me.isAdmin) && <ActionForm action={deleteAnnouncement} className="ml-auto"><input type="hidden" name="id" value={a.id} /><SubmitButton className="btn-ghost btn-sm" confirm="Изтриване?">Изтрий</SubmitButton></ActionForm>}
              </div>
            </Card>
          ))}
        </div>
        {targets.length > 0 && (
          <Card title="Ново съобщение">
            <ActionForm action={sendAnnouncement} className="space-y-3" resetOnOk>
              <Field label="До">
                <select name="target" className="input">
                  {groups.map((g) => <optgroup key={g} label={g}>{targets.filter((t) => t.group === g).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</optgroup>)}
                </select>
              </Field>
              <Field label="Заглавие"><input name="title" required className="input" /></Field>
              <Field label="Текст"><textarea name="body" rows={5} required className="input" /></Field>
              <div className="space-y-1 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" name="push" defaultChecked />Push известие</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="email" />И по имейл</label>
                {canAll && <label className="flex items-center gap-2"><input type="checkbox" name="pinned" />Закачи най-отгоре</label>}
              </div>
              <SubmitButton>Изпрати</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  )
}

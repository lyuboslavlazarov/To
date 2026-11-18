import { notFound } from 'next/navigation'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { loadTeam } from '@/lib/team'
import { PageHeader, Card, Field, Empty } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { localDay } from '@/lib/format'
import { TeamTabs } from '../team-tabs'
import { saveRotation, applyRotation, deleteRotation } from '../../../events/actions'

function RotationEditor({ teamId, positions, members, tpl, weeks }: { teamId: string; positions: any[]; members: any[]; tpl?: any; weeks: number }) {
  const get = (w: number, p: string) => (tpl?.slots ?? []).find((s: any) => s.week === w && s.position_id === p)?.profile_id ?? ''
  return (
    <ActionForm action={saveRotation} className="space-y-3">
      <input type="hidden" name="team_id" value={teamId} />
      {tpl && <input type="hidden" name="id" value={tpl.id} />}
      <div className="flex flex-wrap gap-2">
        <Field label="Име"><input name="name" defaultValue={tpl?.name ?? 'Ротация'} className="input" /></Field>
        <Field label="Цикъл (седмици)"><input name="weeks" type="number" min={1} max={12} defaultValue={weeks} className="input w-24" /></Field>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead><tr><th className="p-1 text-left">Позиция</th>{Array.from({ length: weeks }, (_, w) => <th key={w} className="p-1">Седмица {w + 1}</th>)}</tr></thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.id}>
                <td className="p-1 font-medium">{p.name}</td>
                {Array.from({ length: weeks }, (_, w) => (
                  <td key={w} className="p-1">
                    <select name={`slot:${w}:${p.id}`} defaultValue={get(w, p.id)} className="input w-36 px-1 py-1 text-xs">
                      <option value="">—</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{fullName(m)}</option>)}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SubmitButton className="btn-primary btn-sm">Запази шаблона</SubmitButton>
      {tpl && <p className="muted text-xs">За да промените броя седмици, въведете новия брой, запазете и презаредете.</p>}
    </ActionForm>
  )
}

export default async function RotationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await requireMe()
  const supabase = await createClient()
  const { team, canManage } = await loadTeam(supabase, me, id)
  if (!canManage) notFound()
  const [{ data: tpls }, { data: members }, { data: series }] = await Promise.all([
    supabase.from('rotation_templates').select('*').eq('team_id', id).order('created_at'),
    supabase.from('team_members').select('profiles(id, first_name, last_name)').eq('team_id', id),
    supabase.from('event_series').select('id, title'),
  ])
  const people = (members ?? []).map((m: any) => m.profiles).sort((a: any, b: any) => fullName(a).localeCompare(fullName(b)))
  const today = localDay()
  const in8 = localDay(new Date(Date.now() + 56 * 864e5))
  return (
    <>
      <PageHeader back={`/teams/${id}`} title={team.name} subtitle="Шаблони за ротации: кой на коя позиция служи в коя седмица от цикъла" />
      <TeamTabs id={id} active="rotations" canManage={canManage} />
      <div className="space-y-4">
        {!tpls?.length && <Empty>Няма шаблони. Създайте първия по-долу.</Empty>}
        {(tpls ?? []).map((t) => (
          <Card key={t.id} title={t.name}>
            <RotationEditor teamId={id} positions={team.positions} members={people} tpl={t} weeks={t.weeks} />
            <div className="mt-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
              <div className="mb-2 text-sm font-medium">Приложи върху събития</div>
              <ActionForm action={applyRotation} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={t.id} />
                <Field label="От"><input name="from" type="date" defaultValue={today} className="input" /></Field>
                <Field label="До"><input name="to" type="date" defaultValue={in8} className="input" /></Field>
                <Field label="Само за серия">
                  <select name="series_id" className="input"><option value="">Всички събития</option>{(series ?? []).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
                </Field>
                <SubmitButton className="btn-primary btn-sm" confirm="Ще бъдат изпратени покани според шаблона. Продължаване?">Приложи</SubmitButton>
              </ActionForm>
              <p className="muted mt-2 text-xs">Събитията се редуват по седмиците на цикъла. При конфликт човекът се пропуска.</p>
            </div>
            <ActionForm action={deleteRotation} className="mt-2"><input type="hidden" name="id" value={t.id} /><input type="hidden" name="team_id" value={id} /><SubmitButton className="btn-ghost btn-sm text-rose-600" confirm="Изтриване на шаблона?">Изтрий шаблона</SubmitButton></ActionForm>
          </Card>
        ))}
        <Card title="Нов шаблон"><RotationEditor teamId={id} positions={team.positions} members={people} weeks={4} /></Card>
      </div>
    </>
  )
}

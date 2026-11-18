import Link from 'next/link'
import { requireAdmin, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getStructure, PERMISSIONS, type Team } from '@/lib/data'
import { PageHeader, Card, Badge, Field } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { AdminTabs } from '../tabs'
import { saveDepartment, saveTeam, savePosition, deleteRow, addDepartmentLeader } from '../actions'

function DeleteBtn({ table, id, label = 'Изтрий' }: { table: string; id: string; label?: string }) {
  return (
    <ActionForm action={deleteRow} className="inline">
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="id" value={id} />
      <SubmitButton className="btn-ghost btn-sm text-rose-600" confirm="Сигурни ли сте? Изтриването е окончателно.">{label}</SubmitButton>
    </ActionForm>
  )
}

function TeamForm({ team, departmentId }: { team?: Team; departmentId: string }) {
  return (
    <ActionForm action={saveTeam} className="grid gap-3 sm:grid-cols-2">
      {team && <input type="hidden" name="id" value={team.id} />}
      <input type="hidden" name="department_id" value={departmentId} />
      <Field label="Име на екипа"><input name="name" defaultValue={team?.name} required className="input" /></Field>
      <Field label="Подредба"><input name="sort" type="number" defaultValue={team?.sort ?? 0} className="input" /></Field>
      <Field label="Описание"><input name="description" defaultValue={team?.description ?? ''} className="input" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Възраст от (деца)"><input name="min_age" type="number" defaultValue={team?.min_age ?? ''} className="input" /></Field>
        <Field label="до"><input name="max_age" type="number" defaultValue={team?.max_age ?? ''} className="input" /></Field>
      </div>
      <fieldset className="sm:col-span-2">
        <span className="label">Допълнителни права за членовете</span>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {PERMISSIONS.map((p) => (
            <label key={p.key} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="permissions" value={p.key} defaultChecked={team?.permissions.includes(p.key)} />{p.label}
            </label>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="allow_self_signup" defaultChecked={team?.allow_self_signup} />
          Доброволците могат сами да се записват на позиции
        </label>
      </fieldset>
      <div><SubmitButton className="btn-primary btn-sm">{team ? 'Запази екипа' : 'Добави екип'}</SubmitButton></div>
    </ActionForm>
  )
}

export default async function StructurePage() {
  await requireAdmin()
  const supabase = await createClient()
  const [depts, { data: leaders }, { data: people }] = await Promise.all([
    getStructure(supabase),
    supabase.from('department_leaders').select('department_id, profile:profiles(id, first_name, last_name)'),
    supabase.from('profiles').select('id, first_name, last_name').eq('status', 'active').order('first_name'),
  ])
  return (
    <>
      <PageHeader title="Администрация" subtitle="Отдели → екипи → позиции. Членовете се добавят от страницата на всеки екип." />
      <AdminTabs active="structure" />
      <div className="space-y-5">
        {depts.map((d) => (
          <Card key={d.id}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: d.color }} />
              <h2 className="text-lg font-bold">{d.name}</h2>
              {d.slug && <Badge>{d.slug}</Badge>}
              <div className="ml-auto"><DeleteBtn table="departments" id={d.id} label="Изтрий отдела" /></div>
            </div>
            <details className="mb-3">
              <summary className="cursor-pointer text-sm text-brand-600">Редактирай отдела и лидерите му</summary>
              <ActionForm action={saveDepartment} className="mt-3 grid gap-3 sm:grid-cols-4">
                <input type="hidden" name="id" value={d.id} />
                <Field label="Име"><input name="name" defaultValue={d.name} className="input" /></Field>
                <Field label="Описание"><input name="description" defaultValue={d.description ?? ''} className="input" /></Field>
                <Field label="Цвят"><input name="color" type="color" defaultValue={d.color} className="input h-11 p-1" /></Field>
                <Field label="Подредба"><input name="sort" type="number" defaultValue={d.sort} className="input" /></Field>
                <div><SubmitButton className="btn-primary btn-sm">Запази</SubmitButton></div>
              </ActionForm>
              <div className="mt-4">
                <span className="label">Лидери на целия отдел (виждат и управляват всички екипи в него)</span>
                <div className="mb-2 flex flex-wrap gap-2">
                  {(leaders ?? []).filter((l: any) => l.department_id === d.id).map((l: any) => (
                    <span key={l.profile.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-3 text-sm dark:bg-slate-800">
                      {fullName(l.profile)}
                      <ActionForm action={deleteRow} className="inline">
                        <input type="hidden" name="table" value="department_leaders" />
                        <input type="hidden" name="department_id" value={d.id} />
                        <input type="hidden" name="profile_id" value={l.profile.id} />
                        <SubmitButton className="btn-ghost btn-sm px-2">✕</SubmitButton>
                      </ActionForm>
                    </span>
                  ))}
                </div>
                <ActionForm action={addDepartmentLeader} className="flex gap-2">
                  <input type="hidden" name="department_id" value={d.id} />
                  <select name="profile_id" className="input max-w-xs" required>
                    <option value="">— избери човек —</option>
                    {(people ?? []).map((p) => <option key={p.id} value={p.id}>{fullName(p)}</option>)}
                  </select>
                  <SubmitButton className="btn-secondary btn-sm">Добави лидер</SubmitButton>
                </ActionForm>
              </div>
            </details>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {d.teams.map((t) => (
                <div key={t.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/teams/${t.id}`} className="font-semibold hover:underline">{t.name}</Link>
                    {t.permissions.map((p) => <Badge key={p} color="blue">{PERMISSIONS.find((x) => x.key === p)?.label ?? p}</Badge>)}
                    {t.min_age != null && <Badge color="green">{t.min_age}–{t.max_age} г.</Badge>}
                    <Link href={`/teams/${t.id}/members`} className="btn-ghost btn-sm ml-auto">Членове</Link>
                    <DeleteBtn table="teams" id={t.id} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {t.positions.map((p) => (
                      <details key={p.id} className="rounded-lg bg-slate-50 px-2 py-1 text-sm dark:bg-slate-800/60">
                        <summary className="cursor-pointer">{p.name} <span className="muted">×{p.default_count}</span></summary>
                        <ActionForm action={savePosition} className="mt-2 flex flex-wrap items-end gap-2">
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="team_id" value={t.id} />
                          <input name="name" defaultValue={p.name} className="input w-40" />
                          <input name="default_count" type="number" min={0} defaultValue={p.default_count} className="input w-20" title="Брой хора по подразбиране" />
                          <input name="sort" type="number" defaultValue={p.sort} className="input w-16" title="Подредба" />
                          <SubmitButton className="btn-primary btn-sm">OK</SubmitButton>
                        </ActionForm>
                        <DeleteBtn table="positions" id={p.id} />
                      </details>
                    ))}
                    <ActionForm action={savePosition} className="flex gap-1" resetOnOk>
                      <input type="hidden" name="team_id" value={t.id} />
                      <input name="name" placeholder="Нова позиция" className="input w-36 py-1" required />
                      <input name="default_count" type="number" min={0} defaultValue={1} className="input w-16 py-1" />
                      <SubmitButton className="btn-secondary btn-sm">+</SubmitButton>
                    </ActionForm>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-brand-600">Настройки на екипа</summary>
                    <div className="mt-2"><TeamForm team={t} departmentId={d.id} /></div>
                  </details>
                </div>
              ))}
            </div>
            <details className="mt-3 rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-700">
              <summary className="cursor-pointer text-sm font-medium">+ Нов екип в „{d.name}“</summary>
              <div className="mt-3"><TeamForm departmentId={d.id} /></div>
            </details>
          </Card>
        ))}
        <Card title="Нов отдел">
          <ActionForm action={saveDepartment} className="grid gap-3 sm:grid-cols-4" resetOnOk>
            <Field label="Име"><input name="name" required className="input" /></Field>
            <Field label="Описание"><input name="description" className="input" /></Field>
            <Field label="Цвят"><input name="color" type="color" defaultValue="#6366f1" className="input h-11 p-1" /></Field>
            <Field label="Подредба"><input name="sort" type="number" defaultValue={depts.length + 1} className="input" /></Field>
            <div><SubmitButton>Добави отдел</SubmitButton></div>
          </ActionForm>
        </Card>
      </div>
    </>
  )
}

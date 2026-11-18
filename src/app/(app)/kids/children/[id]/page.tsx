import { notFound, redirect } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Badge, Field } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { ChildForm } from '@/components/child-form'
import { ageFrom, fmtDate, fmtDateTime, fmtTime } from '@/lib/format'
import { addGuardian, removeGuardian, deactivateChild } from '../../actions'

export default async function ChildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await requireMe()
  if (!me.isKidsStaff) redirect('/')
  const supabase = await createClient()
  const { data: child } = await supabase.from('children').select('*').eq('id', id).maybeSingle()
  if (!child) notFound()
  const [{ data: care }, { data: canCare }, { data: guardians }, { data: visits }, { data: groups }] = await Promise.all([
    supabase.from('child_care').select('*').eq('child_id', id).maybeSingle(),
    supabase.rpc('can_see_child_care', { p_child: id }),
    supabase.from('child_guardians').select('relationship, can_pick_up, guardians(id, first_name, last_name, phone, email)').eq('child_id', id),
    supabase.from('checkins').select('id, checked_in_at, checked_out_at, picked_up_by, teams(name)').eq('child_id', id).order('checked_in_at', { ascending: false }).limit(30),
    supabase.from('teams').select('id, name, departments!inner(slug)').eq('departments.slug', 'kids').not('min_age', 'is', null).order('min_age'),
  ])
  const age = ageFrom(child.birthdate)
  return (
    <>
      <PageHeader back="/kids/children" title={`${child.first_name} ${child.last_name}`}
        subtitle={<>{age != null ? `${age} г. · ` : ''}{(groups ?? []).find((g) => g.id === child.group_team_id)?.name ?? 'без група'}{child.consent_at ? ' · съгласие ✓' : ' · ⚠ няма съгласие'}</>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {canCare && (care?.allergies || care?.medical_notes || care?.notes) && (
            <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-900/20">
              <div className="font-semibold text-rose-700 dark:text-rose-300">⚠ Здравни данни</div>
              {care.allergies && <p className="text-sm"><b>Алергии:</b> {care.allergies}</p>}
              {care.medical_notes && <p className="text-sm"><b>Здраве:</b> {care.medical_notes}</p>}
              {care.notes && <p className="text-sm"><b>Бележки:</b> {care.notes}</p>}
            </div>
          )}
          {!canCare && <p className="muted text-xs">🔒 Здравните данни виждат само учителите на групата и главният лидер.</p>}
          <Card title="Данни"><ChildForm child={child} care={care} groups={groups ?? []} canCare={!!canCare} /></Card>
          <Card title="Посещения">
            {!visits?.length ? <p className="muted text-sm">Няма посещения.</p> : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {visits.map((v: any) => (
                  <li key={v.id} className="flex justify-between py-1.5">
                    <span>{fmtDateTime(v.checked_in_at)} · {v.teams?.name}</span>
                    <span className="muted text-xs">{v.checked_out_at ? `взет ${fmtTime(v.checked_out_at)}${v.picked_up_by ? ' от ' + v.picked_up_by : ''}` : 'вътре'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Родители / настойници">
            <ul className="space-y-2 text-sm">
              {(guardians ?? []).map((g: any) => (
                <li key={g.guardians.id} className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="font-medium">{g.guardians.first_name} {g.guardians.last_name} <span className="muted text-xs">({g.relationship})</span></div>
                    <div className="text-xs">{g.guardians.phone && <a href={`tel:${g.guardians.phone}`}>📞 {g.guardians.phone}</a>} {g.guardians.email}</div>
                    {!g.can_pick_up && <Badge color="red">не може да взима детето</Badge>}
                  </div>
                  <ActionForm action={removeGuardian}><input type="hidden" name="child_id" value={id} /><input type="hidden" name="guardian_id" value={g.guardians.id} /><SubmitButton className="btn-ghost btn-sm" confirm="Премахване?">✕</SubmitButton></ActionForm>
                </li>
              ))}
            </ul>
            <details className="mt-3"><summary className="cursor-pointer text-sm text-brand-600">+ Добави</summary>
              <ActionForm action={addGuardian} className="mt-2 space-y-2" resetOnOk>
                <input type="hidden" name="child_id" value={id} />
                <div className="grid grid-cols-2 gap-2"><input name="first_name" placeholder="Име" required className="input" /><input name="last_name" placeholder="Фамилия" className="input" /></div>
                <input name="phone" type="tel" placeholder="Телефон" className="input" />
                <input name="email" type="email" placeholder="Имейл" className="input" />
                <Field label="Връзка"><select name="relationship" className="input"><option>майка</option><option>баща</option><option>баба</option><option>дядо</option><option>настойник</option><option>друг</option></select></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="can_pick_up" defaultChecked />Може да взима детето</label>
                <SubmitButton className="btn-secondary btn-sm">Добави</SubmitButton>
              </ActionForm>
            </details>
          </Card>
          <Card title="GDPR">
            <p className="muted mb-2 text-xs">Съгласие: {child.consent_at ? `${fmtDate(child.consent_at)}${child.consent_by_name ? ' от ' + child.consent_by_name : ''}` : 'няма'}</p>
            <div className="flex flex-wrap gap-2">
              <ActionForm action={deactivateChild}><input type="hidden" name="id" value={id} /><SubmitButton className="btn-secondary btn-sm" confirm="Да скрия ли детето от списъците?">Деактивирай</SubmitButton></ActionForm>
              <ActionForm action={deactivateChild}><input type="hidden" name="id" value={id} /><input type="hidden" name="delete" value="true" /><SubmitButton className="btn-ghost btn-sm text-rose-600" confirm="Всички данни за детето (вкл. посещения) ще бъдат изтрити окончателно. Продължаване?">Изтрий всички данни</SubmitButton></ActionForm>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

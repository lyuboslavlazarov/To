import Link from 'next/link'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { loadTeam } from '@/lib/team'
import { PageHeader, Card, Avatar, Badge } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { TeamTabs } from '../team-tabs'
import { addMember, removeMember, setLeader } from '../../actions'
import { toggleMemberPosition } from '../../../people/actions'

export default async function MembersPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const { id } = await params
  const { q } = await searchParams
  const me = await requireMe()
  const supabase = await createClient()
  const { team, canManage } = await loadTeam(supabase, me, id)
  const [{ data: members }, { data: mpos }, { data: found }] = await Promise.all([
    supabase.from('team_members').select('is_leader, profiles(id, first_name, last_name, avatar_url, email, phone)').eq('team_id', id),
    supabase.from('member_positions').select('profile_id, position_id').in('position_id', team.positions.map((p: any) => p.id)),
    canManage && q ? supabase.rpc('search_people', { p_query: q }) : Promise.resolve({ data: null }),
  ])
  const memberIds = new Set((members ?? []).map((m: any) => m.profiles.id))
  const has = (pid: string, pos: string) => (mpos ?? []).some((m) => m.profile_id === pid && m.position_id === pos)

  return (
    <>
      <PageHeader back={`/teams/${id}`} title={team.name} subtitle="Членове и позициите, на които всеки може да служи" />
      <TeamTabs id={id} active="members" canManage={canManage} />
      {canManage && (
        <Card title="Добави член" className="mb-4">
          <form className="flex gap-2">
            <input name="q" defaultValue={q} placeholder="Търси по име или имейл…" className="input" />
            <button className="btn-secondary">Търси</button>
          </form>
          {found && (
            <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {(found as any[]).filter((p) => !memberIds.has(p.id)).map((p) => (
                <li key={p.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="flex-1">{fullName(p)} {p.email && <span className="muted text-xs">{p.email}</span>}</span>
                  <ActionForm action={addMember}>
                    <input type="hidden" name="team_id" value={id} /><input type="hidden" name="profile_id" value={p.id} />
                    <SubmitButton className="btn-primary btn-sm">+ Добави</SubmitButton>
                  </ActionForm>
                </li>
              ))}
              {!(found as any[]).length && <li className="muted py-2 text-sm">Няма намерени активни хора.</li>}
            </ul>
          )}
        </Card>
      )}
      <Card className="p-0">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {(members ?? []).map((m: any) => {
            const p = m.profiles
            return (
              <li key={p.id} className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar p={p} size={36} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/people/${p.id}`} className="font-medium hover:underline">{fullName(p)}</Link>
                    {m.is_leader && <Badge color="blue">Лидер</Badge>}
                    <div className="muted text-xs">{p.phone ?? p.email}</div>
                  </div>
                  {me.isAdmin && (
                    <ActionForm action={setLeader}>
                      <input type="hidden" name="team_id" value={id} /><input type="hidden" name="profile_id" value={p.id} />
                      <input type="hidden" name="is_leader" value={m.is_leader ? 'false' : 'true'} />
                      <SubmitButton className="btn-ghost btn-sm">{m.is_leader ? 'Махни лидерство' : '★ Направи лидер'}</SubmitButton>
                    </ActionForm>
                  )}
                  {canManage && (!m.is_leader || me.isAdmin) && (
                    <ActionForm action={removeMember}>
                      <input type="hidden" name="team_id" value={id} /><input type="hidden" name="profile_id" value={p.id} />
                      <SubmitButton className="btn-ghost btn-sm text-rose-600" confirm={`Да премахна ли ${fullName(p)} от екипа?`}>Премахни</SubmitButton>
                    </ActionForm>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 pl-12">
                  {team.positions.map((pos: any) => {
                    const on = has(p.id, pos.id)
                    return canManage ? (
                      <ActionForm key={pos.id} action={toggleMemberPosition}>
                        <input type="hidden" name="profile_id" value={p.id} /><input type="hidden" name="position_id" value={pos.id} />
                        <input type="hidden" name="on" value={on ? 'false' : 'true'} />
                        <SubmitButton className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-200' : 'border-slate-300 text-slate-500 dark:border-slate-700'}`}>
                          {on ? '✓ ' : '+ '}{pos.name}
                        </SubmitButton>
                      </ActionForm>
                    ) : on ? <Badge key={pos.id}>{pos.name}</Badge> : null
                  })}
                </div>
              </li>
            )
          })}
        </ul>
      </Card>
    </>
  )
}

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getStructure } from '@/lib/data'
import { PageHeader, Card, Avatar, Badge, Empty } from '@/components/ui'
import { ROLE_LABEL, STATUS_LABEL } from '@/lib/format'

export const metadata = { title: 'Хора' }

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; team?: string; status?: string; role?: string; skill?: string }> }) {
  const me = await requireMe()
  if (!me.isStaff && !me.isLeader) redirect('/')
  const sp = await searchParams
  const supabase = await createClient()

  let q = supabase.from('profiles')
    .select('id, first_name, last_name, email, phone, avatar_url, status, system_role, skills, team_members(team_id, is_leader, teams(name))')
    .order('first_name').order('last_name').limit(500)
  const term = sp.q?.replace(/[,()*%\\]/g, ' ').trim()
  if (term) q = q.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`)
  q = q.eq('status', sp.status ?? 'active')
  if (sp.role) q = q.eq('system_role', sp.role)
  if (sp.skill) q = q.contains('skills', [sp.skill])
  const [{ data: people }, depts] = await Promise.all([q, getStructure(supabase)])

  const list = (people ?? []).filter((p: any) => !sp.team || p.team_members?.some((m: any) => m.team_id === sp.team))
  // кога последно е служил
  const ids = list.map((p: any) => p.id)
  const { data: last } = ids.length
    ? await supabase.from('assignments').select('profile_id, events!inner(starts_at)').in('profile_id', ids).eq('status', 'confirmed').lt('events.starts_at', new Date().toISOString())
    : { data: [] }
  const lastBy = new Map<string, string>()
  for (const a of (last ?? []) as any[]) {
    const s = a.events.starts_at
    if (!lastBy.has(a.profile_id) || lastBy.get(a.profile_id)! < s) lastBy.set(a.profile_id, s)
  }

  return (
    <>
      <PageHeader title="Хора" subtitle={me.isStaff ? 'Всички хора в организацията' : 'Хората от вашите екипи'}
        actions={me.isAdmin && <Link href="/admin/invite" className="btn-primary">+ Добави човек</Link>} />
      <form className="card mb-4 grid gap-2 p-3 sm:grid-cols-5">
        <input name="q" defaultValue={sp.q} placeholder="Търсене по име, имейл, телефон…" className="input sm:col-span-2" />
        <select name="team" defaultValue={sp.team ?? ''} className="input">
          <option value="">Всички екипи</option>
          {depts.map((d) => <optgroup key={d.id} label={d.name}>{d.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}
        </select>
        {me.isStaff ? (
          <select name="status" defaultValue={sp.status ?? 'active'} className="input">
            <option value="active">Активни</option><option value="pending">Чакат одобрение</option><option value="inactive">Неактивни</option>
          </select>
        ) : <input type="hidden" name="status" value="active" />}
        <div className="flex gap-2">
          <input name="skill" defaultValue={sp.skill} placeholder="Умение" className="input" />
          <button className="btn-primary">Търси</button>
        </div>
      </form>
      {!list.length ? <Empty>Няма намерени хора.</Empty> : (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.map((p: any) => (
              <li key={p.id}>
                <Link href={`/people/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Avatar p={p} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {fullName(p)}
                      {p.system_role !== 'member' && <Badge color="blue">{ROLE_LABEL[p.system_role]}</Badge>}
                      {p.status !== 'active' && <Badge color="yellow">{STATUS_LABEL[p.status]}</Badge>}
                    </div>
                    <div className="muted truncate text-xs">
                      {(p.team_members ?? []).map((m: any) => m.teams?.name + (m.is_leader ? ' ★' : '')).join(' · ') || 'без екип'}
                    </div>
                  </div>
                  <div className="muted hidden text-right text-xs sm:block">
                    <div>{p.phone}</div>
                    <div>{lastBy.get(p.id) ? 'служил: ' + new Date(lastBy.get(p.id)!).toLocaleDateString('bg-BG') : 'още не е служил'}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="muted mt-2 text-xs">{list.length} души</p>
    </>
  )
}

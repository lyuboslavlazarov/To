import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Empty } from '@/components/ui'
import { ageFrom } from '@/lib/format'
import { KidsTabs } from '../kids-tabs'

export default async function ChildrenPage({ searchParams }: { searchParams: Promise<{ group?: string; q?: string }> }) {
  const me = await requireMe()
  if (!me.isKidsStaff) redirect('/')
  const sp = await searchParams
  const supabase = await createClient()
  const [{ data: groups }, { data: kids }] = await Promise.all([
    supabase.from('teams').select('id, name, departments!inner(slug)').eq('departments.slug', 'kids').not('min_age', 'is', null).order('min_age'),
    supabase.from('children').select('id, first_name, last_name, birthdate, group_team_id, child_guardians(guardians(first_name, last_name, phone))').eq('is_active', true).order('first_name'),
  ])
  const q = (sp.q ?? '').toLowerCase()
  const list = (kids ?? []).filter((k) => (!sp.group || k.group_team_id === sp.group) && (!q || `${k.first_name} ${k.last_name}`.toLowerCase().includes(q)))
  return (
    <>
      <PageHeader title="Детско служение" actions={<Link href="/kids/children/new" className="btn-primary">+ Ново дете</Link>} />
      <KidsTabs active="children" />
      <form className="mb-3 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Търсене…" className="input max-w-xs" />
        <select name="group" defaultValue={sp.group ?? ''} className="input w-auto"><option value="">Всички групи</option>{(groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        <button className="btn-secondary">Филтър</button>
      </form>
      {!list.length ? <Empty>Няма деца.</Empty> : (
        <Card className="p-0">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.map((k: any) => (
              <li key={k.id}>
                <Link href={`/kids/children/${k.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <div className="flex-1">
                    <div className="font-medium">{k.first_name} {k.last_name}</div>
                    <div className="muted text-xs">{(k.child_guardians ?? []).map((cg: any) => `${cg.guardians?.first_name} ${cg.guardians?.phone ?? ''}`).join(' · ')}</div>
                  </div>
                  <div className="muted text-right text-xs">{ageFrom(k.birthdate) != null && <div>{ageFrom(k.birthdate)} г.</div>}<div>{(groups ?? []).find((g) => g.id === k.group_team_id)?.name ?? 'без група'}</div></div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

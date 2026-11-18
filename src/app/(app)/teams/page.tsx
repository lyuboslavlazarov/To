import Link from 'next/link'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getStructure } from '@/lib/data'
import { PageHeader, Card, Badge, Empty } from '@/components/ui'

export const metadata = { title: 'Екипи' }

export default async function TeamsPage() {
  const me = await requireMe()
  const supabase = await createClient()
  const depts = await getStructure(supabase)
  const visible = (t: any) => me.isStaff || me.teamIds.includes(t.id) || me.ledTeamIds.includes(t.id) || me.ledDepartmentIds.includes(t.department_id)
  const list = depts.map((d) => ({ ...d, teams: d.teams.filter(visible) })).filter((d) => d.teams.length)
  return (
    <>
      <PageHeader title={me.isStaff ? 'Всички екипи' : 'Моите екипи'} subtitle="Всяко служение вижда само своите графици, задачи, хора и съобщения." />
      {!list.length ? <Empty>Още не сте добавени в служение. Администраторът ще ви добави.</Empty> : (
        <div className="space-y-5">
          {list.map((d) => (
            <div key={d.id}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide" style={{ color: d.color }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />{d.name}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {d.teams.map((t) => (
                  <Link key={t.id} href={`/teams/${t.id}`}>
                    <Card className="h-full transition hover:border-brand-300">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold">{t.name}</div>
                        {me.ledTeamIds.includes(t.id) && <Badge color="blue">Лидер</Badge>}
                      </div>
                      <div className="muted mt-1 text-xs">{t.positions.map((p) => p.name).join(' · ')}</div>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

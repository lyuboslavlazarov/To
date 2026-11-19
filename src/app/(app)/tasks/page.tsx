import Link from 'next/link'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Badge, Empty, Tabs, statusColor } from '@/components/ui'
import { fmtDateTime, STATUS_LABEL } from '@/lib/format'

export const metadata = { title: 'Задачи' }
const PRIO: Record<number, [string, string]> = { 1: ['спешно', 'red'], 2: ['', 'gray'], 3: ['ниско', 'gray'] }

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string; team?: string; done?: string }> }) {
  const me = await requireMe()
  const sp = await searchParams
  const view = sp.view ?? (sp.team ? 'team' : 'mine')
  const supabase = await createClient()
  const canLead = me.isStaff || me.isLeader

  let tq = supabase.from('tasks').select('*, teams(name), assignee:profiles!tasks_assignee_id_fkey(first_name, last_name)').order('status').order('due_at', { nullsFirst: false }).limit(200)
  if (view === 'mine') tq = tq.eq('assignee_id', me.id)
  if (view === 'issues') tq = tq.eq('is_issue', true)
  if (view === 'team' && sp.team) tq = tq.eq('team_id', sp.team)
  if (!sp.done) tq = tq.neq('status', 'done')
  let cq = supabase.from('checklists').select('id, title, due_at, completed_at, team_id, assignee_id, teams(name), checklist_items(id, done_at)').order('due_at').limit(100)
  if (!sp.done) cq = cq.is('completed_at', null)
  if (view === 'mine') cq = cq.eq('assignee_id', me.id)
  if (sp.team) cq = cq.eq('team_id', sp.team)
  cq = cq.lte('due_at', new Date(Date.now() + 8 * 864e5).toISOString())
  const [{ data: tasks }, { data: lists }] = await Promise.all([
    view === 'checklists' ? Promise.resolve({ data: [] as any[] }) : tq,
    view === 'issues' ? Promise.resolve({ data: [] as any[] }) : cq,
  ])
  const overdue = (d?: string | null) => d && new Date(d) < new Date()

  return (
    <>
      <PageHeader title="Задачи и чеклисти"
        actions={<>
          <Link href="/tasks/new?issue=1" className="btn-secondary">🔧 Сигнал за повреда</Link>
          {canLead && <Link href="/tasks/new" className="btn-primary">+ Задача</Link>}
          {canLead && <Link href="/tasks/templates" className="btn-ghost">Шаблони</Link>}
        </>} />
      <Tabs active={view} tabs={[
        { key: 'mine', href: '/tasks?view=mine', label: 'Моите' },
        { key: 'team', href: '/tasks?view=team', label: 'На екипите ми' },
        { key: 'checklists', href: '/tasks?view=checklists', label: 'Чеклисти' },
        { key: 'issues', href: '/tasks?view=issues', label: 'Сигнали за повреди' },
      ]} />
      {view === 'team' && (
        <div className="mb-3 flex flex-wrap gap-1">
          <Link href="/tasks?view=team" className={`btn-sm ${!sp.team ? 'btn-primary' : 'btn-secondary'}`}>Всички</Link>
          {me.memberships.map((m) => <Link key={m.team_id} href={`/tasks?view=team&team=${m.team_id}`} className={`btn-sm ${sp.team === m.team_id ? 'btn-primary' : 'btn-secondary'}`}>{m.team.name}</Link>)}
        </div>
      )}
      <div className="mb-3 text-right text-xs"><Link href={`?view=${view}${sp.team ? '&team=' + sp.team : ''}${sp.done ? '' : '&done=1'}`} className="text-brand-600">{sp.done ? 'Скрий изпълнените' : 'Покажи и изпълнените'}</Link></div>

      <div className="space-y-4">
        {view !== 'issues' && !!lists?.length && (
          <Card title="Чеклисти">
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {(lists as any[]).map((c) => {
                const done = (c.checklist_items ?? []).filter((i: any) => i.done_at).length
                const total = (c.checklist_items ?? []).length
                return (
                  <li key={c.id}>
                    <Link href={`/tasks/checklists/${c.id}`} className="flex items-center gap-3 py-2.5">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${c.completed_at ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 dark:bg-slate-800'}`}>{c.completed_at ? '✓' : `${done}/${total}`}</span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{c.title}</div>
                        <div className={`text-xs ${!c.completed_at && overdue(c.due_at) ? 'text-rose-600' : 'muted'}`}>{c.teams?.name} · до {fmtDateTime(c.due_at)}</div>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </Card>
        )}
        {view !== 'checklists' && (
          <Card title={view === 'issues' ? 'Сигнали за повреди' : 'Задачи'}>
            {!tasks?.length ? <Empty>Няма задачи.</Empty> : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {(tasks as any[]).map((t) => (
                  <li key={t.id}>
                    <Link href={`/tasks/${t.id}`} className="flex items-center gap-3 py-2.5">
                      <span className="text-lg">{t.is_issue ? '🔧' : t.status === 'done' ? '✅' : '☐'}</span>
                      <div className="min-w-0 flex-1">
                        <div className={`font-medium ${t.status === 'done' ? 'line-through opacity-60' : ''}`}>{t.title}</div>
                        <div className={`text-xs ${t.status !== 'done' && overdue(t.due_at) ? 'text-rose-600' : 'muted'}`}>
                          {[t.teams?.name, t.assignee ? fullName(t.assignee) : 'без отговорник', t.due_at ? 'до ' + fmtDateTime(t.due_at) : null, t.location].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      {t.priority === 1 && <Badge color="red">{PRIO[1][0]}</Badge>}
                      <Badge color={statusColor(t.status)}>{STATUS_LABEL[t.status]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {view === 'checklists' && !lists?.length && <Empty>Няма чеклисти за следващите дни.</Empty>}
      </div>
    </>
  )
}

import { requireAdmin, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Badge } from '@/components/ui'
import { fmtDateTime } from '@/lib/format'
import { AdminTabs } from '../tabs'

const TABLES: Record<string, string> = {
  profiles: 'Профили', profile_notes: 'Бележки', team_members: 'Членство', assignments: 'Графици', events: 'Събития',
  children: 'Деца', child_care: 'Здравни данни', guardians: 'Родители', checkins: 'Регистриране деца', registrations: 'Регистрации',
  gifts: 'Подаръци', tasks: 'Задачи', announcements: 'Съобщения', departments: 'Отдели', teams: 'Екипи', positions: 'Позиции',
  app_settings: 'Настройки', room_bookings: 'Резервации',
}
const ACT: Record<string, [string, string]> = { INSERT: ['добави', 'green'], UPDATE: ['промени', 'yellow'], DELETE: ['изтри', 'red'] }

function diff(o: any, n: any) {
  if (!o || !n) return null
  return Object.keys(n).filter((k) => k !== 'updated_at' && JSON.stringify(o[k]) !== JSON.stringify(n[k]))
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ table?: string; page?: string }> }) {
  await requireAdmin()
  const sp = await searchParams
  const page = Number(sp.page ?? 0)
  const supabase = await createClient()
  let q = supabase.from('audit_log').select('*').order('at', { ascending: false }).range(page * 50, page * 50 + 49)
  if (sp.table) q = q.eq('table_name', sp.table)
  const { data: rows } = await q
  const actorIds = [...new Set((rows ?? []).map((r) => r.actor_id).filter(Boolean))]
  const { data: actors } = actorIds.length ? await supabase.from('profiles').select('id, first_name, last_name').in('id', actorIds) : { data: [] }
  const actor = (id: string) => (id ? fullName((actors ?? []).find((a: any) => a.id === id)) : 'Системата')
  return (
    <>
      <PageHeader title="Администрация" subtitle="Кой какво е променил. Записите не могат да се редактират или изтриват." />
      <AdminTabs active="audit" />
      <form className="mb-3 flex gap-2">
        <select name="table" defaultValue={sp.table ?? ''} className="input max-w-xs">
          <option value="">Всички</option>
          {Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn-secondary">Филтър</button>
      </form>
      <Card className="overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>Кога</th><th>Кой</th><th>Действие</th><th>Какво</th><th>Полета</th></tr></thead>
          <tbody>
            {(rows ?? []).map((r) => {
              const [label, color] = ACT[r.action] ?? [r.action, 'gray']
              const d = diff(r.old_data, r.new_data)
              return (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(r.at)}</td>
                  <td>{actor(r.actor_id)}</td>
                  <td><Badge color={color}>{label}</Badge></td>
                  <td>{TABLES[r.table_name] ?? r.table_name}</td>
                  <td className="muted max-w-xs truncate text-xs">{d ? d.join(', ') : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
      <div className="mt-3 flex gap-2">
        {page > 0 && <a className="btn-secondary btn-sm" href={`?table=${sp.table ?? ''}&page=${page - 1}`}>← По-нови</a>}
        {(rows?.length ?? 0) === 50 && <a className="btn-secondary btn-sm" href={`?table=${sp.table ?? ''}&page=${page + 1}`}>По-стари →</a>}
      </div>
    </>
  )
}

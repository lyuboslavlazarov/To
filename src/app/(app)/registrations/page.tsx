import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Badge, Empty } from '@/components/ui'
import { fmtDateTime } from '@/lib/format'

export const metadata = { title: 'Регистрации' }

export default async function RegistrationsPage() {
  const me = await requireMe()
  if (!me.can('registrations')) redirect('/')
  const supabase = await createClient()
  const [{ data: evs }, { data: regs }] = await Promise.all([
    supabase.from('reg_events').select('*').order('starts_at', { ascending: false, nullsFirst: true }),
    supabase.from('registrations').select('reg_event_id, status, checked_in_at'),
  ])
  const stat = (id: string) => {
    const r = (regs ?? []).filter((x) => x.reg_event_id === id)
    return { c: r.filter((x) => x.status === 'confirmed').length, w: r.filter((x) => x.status === 'waitlist').length, in: r.filter((x) => x.checked_in_at).length }
  }
  return (
    <>
      <PageHeader title="Регистрации за събития" subtitle="Публични страници за записване – без нужда от акаунт."
        actions={<Link href="/registrations/new" className="btn-primary">+ Нова регистрация</Link>} />
      {!evs?.length ? <Empty>Няма регистрации.</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {evs.map((e) => {
            const s = stat(e.id)
            return (
              <Link key={e.id} href={`/registrations/${e.id}`}>
                <Card className="h-full hover:border-brand-300">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold">{e.title}</div>
                    {!e.is_published ? <Badge>чернова</Badge> : !e.is_open ? <Badge color="red">затворена</Badge> : <Badge color="green">отворена</Badge>}
                  </div>
                  <div className="muted text-xs">{e.starts_at ? fmtDateTime(e.starts_at) : 'без дата'}{e.use_seating ? ' · схема на залата' : ''}</div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full bg-brand-600" style={{ width: `${Math.min(100, (s.c / Math.max(e.capacity, 1)) * 100)}%` }} />
                  </div>
                  <div className="mt-1 flex gap-3 text-xs">
                    <span>{s.c}/{e.capacity} записани</span>{s.w > 0 && <span className="text-amber-600">{s.w} чакат</span>}{s.in > 0 && <span className="text-emerald-600">{s.in} влезли</span>}
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </>
  )
}

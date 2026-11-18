import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Empty } from '@/components/ui'
import { fmtDateTime } from '@/lib/format'

async function markAll() {
  'use server'
  const me = await requireMe()
  const supabase = await createClient()
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('profile_id', me.id).is('read_at', null)
  revalidatePath('/', 'layout')
}

export default async function NotificationsPage() {
  const me = await requireMe()
  const supabase = await createClient()
  const { data } = await supabase.from('notifications').select('*').eq('profile_id', me.id).order('created_at', { ascending: false }).limit(100)
  return (
    <>
      <PageHeader title="Известия" actions={<form action={markAll}><button className="btn-secondary btn-sm">Маркирай всички като прочетени</button></form>} />
      {!data?.length ? <Empty>Нямате известия.</Empty> : (
        <ul className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
          {data.map((n) => (
            <li key={n.id} className={n.read_at ? '' : 'bg-brand-50/60 dark:bg-brand-700/10'}>
              <Link href={n.url ?? '#'} className="block px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{!n.read_at && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand-600" />}{n.title}</div>
                  <span className="muted shrink-0 text-xs">{fmtDateTime(n.created_at)}</span>
                </div>
                {n.body && <p className="muted mt-0.5 text-sm">{n.body}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

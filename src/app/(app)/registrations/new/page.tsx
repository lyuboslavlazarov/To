import { redirect } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card } from '@/components/ui'
import { RegEventForm } from '@/components/reg-event-form'

export default async function NewReg() {
  const me = await requireMe()
  if (!me.can('registrations')) redirect('/')
  const supabase = await createClient()
  const [{ data: events }, { data: rooms }] = await Promise.all([
    supabase.from('events').select('id, title, starts_at').gte('starts_at', new Date().toISOString()).order('starts_at').limit(100),
    supabase.from('rooms').select('*').order('sort'),
  ])
  return (
    <>
      <PageHeader back="/registrations" title="Нова регистрация" />
      <Card><RegEventForm events={events ?? []} rooms={rooms ?? []} /></Card>
    </>
  )
}

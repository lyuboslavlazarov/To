import { redirect } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getStructure } from '@/lib/data'
import { PageHeader, Card } from '@/components/ui'
import { EventForm } from '@/components/event-form'

export default async function NewEvent() {
  const me = await requireMe()
  if (!me.can('events')) redirect('/events')
  const supabase = await createClient()
  const [{ data: rooms }, depts] = await Promise.all([supabase.from('rooms').select('id, name').order('sort'), getStructure(supabase)])
  return (
    <>
      <PageHeader back="/events" title="Ново събитие" />
      <Card><EventForm rooms={rooms ?? []} depts={depts} /></Card>
    </>
  )
}

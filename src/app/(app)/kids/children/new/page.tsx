import { redirect } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card } from '@/components/ui'
import { ChildForm } from '@/components/child-form'

export default async function NewChild() {
  const me = await requireMe()
  if (!me.isKidsStaff) redirect('/')
  const { data: groups } = await (await createClient()).from('teams').select('id, name, departments!inner(slug)').eq('departments.slug', 'kids').not('min_age', 'is', null).order('min_age')
  return (
    <>
      <PageHeader back="/kids/children" title="Ново дете" />
      <Card><ChildForm groups={groups ?? []} canCare isNew /></Card>
    </>
  )
}

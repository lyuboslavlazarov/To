import { notFound, redirect } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui'
import { ScanClient } from './scan-client'

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await requireMe()
  if (!me.can('registrations')) redirect('/')
  const { data: e } = await (await createClient()).from('reg_events').select('title').eq('id', id).maybeSingle()
  if (!e) notFound()
  return (
    <>
      <PageHeader back={`/registrations/${id}`} title="Сканиране на вход" subtitle={e.title} />
      <ScanClient id={id} />
    </>
  )
}

import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { loadTeam } from '@/lib/team'
import { PageHeader } from '@/components/ui'
import { TeamChat } from '@/components/team-chat'
import { TeamTabs } from '../team-tabs'

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await requireMe()
  const supabase = await createClient()
  const { team, canManage } = await loadTeam(supabase, me, id)
  const { data } = await supabase.from('team_messages').select('id, author_id, author_name, body, created_at').eq('team_id', id).order('created_at', { ascending: false }).limit(100)
  return (
    <>
      <PageHeader back={`/teams/${id}`} title={team.name} subtitle="Чат на екипа – вижда се само от членовете" />
      <TeamTabs id={id} active="chat" canManage={canManage} />
      <TeamChat teamId={id} meId={me.id} initial={(data ?? []).reverse()} />
    </>
  )
}

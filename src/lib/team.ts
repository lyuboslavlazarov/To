import 'server-only'
import { notFound } from 'next/navigation'
import type { Me } from '@/lib/auth'

export async function loadTeam(supabase: any, me: Me, id: string) {
  const { data: team } = await supabase.from('teams').select('*, departments(id, name, color, slug), positions(*)').eq('id', id).maybeSingle()
  if (!team) notFound()
  const isMember = me.teamIds.includes(id)
  const canManage = me.isStaff || me.ledTeamIds.includes(id) || me.ledDepartmentIds.includes(team.department_id)
  if (!isMember && !canManage) notFound()
  team.positions = (team.positions ?? []).sort((a: any, b: any) => a.sort - b.sort)
  return { team, isMember, canManage }
}

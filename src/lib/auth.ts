import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type Membership = {
  team_id: string
  is_leader: boolean
  team: { id: string; name: string; department_id: string; permissions: string[]; department: { slug: string | null; name: string } | null }
}

export type Me = {
  id: string
  email: string
  profile: any
  role: 'admin' | 'leadership' | 'member'
  isAdmin: boolean
  isLeadership: boolean
  isStaff: boolean
  aal: string
  needsMfa: boolean
  memberships: Membership[]
  teamIds: string[]
  ledTeamIds: string[]
  ledDepartmentIds: string[]
  isLeader: boolean
  isKidsStaff: boolean
  can: (perm: 'events' | 'registrations' | 'checkins' | 'rooms' | 'gifts' | 'announcements') => boolean
}

export const getMe = cache(async (): Promise<Me | null> => {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const uid = claims?.claims?.sub
  if (!uid) return null

  const [{ data: profile }, { data: memberships }, { data: deptLeads }, { data: aalData }, { data: mfaSetting }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', uid).single(),
    supabase
      .from('team_members')
      .select('team_id, is_leader, team:teams(id, name, department_id, permissions, department:departments(slug, name))')
      .eq('profile_id', uid),
    supabase.from('department_leaders').select('department_id').eq('profile_id', uid),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.from('app_settings').select('value').eq('key', 'require_mfa_for_staff').maybeSingle(),
  ])
  if (!profile) return null

  const role = profile.system_role as Me['role']
  const active = profile.status === 'active'
  const aal = aalData?.currentLevel ?? 'aal1'
  const requireMfa = mfaSetting ? mfaSetting.value !== false : true
  const isPrivileged = active && (role === 'admin' || role === 'leadership')
  const needsMfa = isPrivileged && requireMfa && aal !== 'aal2'
  const ms = ((memberships ?? []) as any[]) as Membership[]
  const ledDepartmentIds = (deptLeads ?? []).map((d: any) => d.department_id)
  const ledTeamIds = [
    ...new Set([
      ...ms.filter((m) => m.is_leader).map((m) => m.team_id),
    ]),
  ]
  const perms = new Set(ms.flatMap((m) => m.team?.permissions ?? []))
  const isStaff = isPrivileged && !needsMfa
  const isKidsStaff =
    isStaff || perms.has('checkins') || ms.some((m) => m.team?.department?.slug === 'kids') || ledDepartmentIds.length > 0

  return {
    id: uid,
    email: profile.email,
    profile,
    role,
    isAdmin: isStaff && role === 'admin',
    isLeadership: isStaff && role === 'leadership',
    isStaff,
    aal,
    needsMfa,
    memberships: ms,
    teamIds: ms.map((m) => m.team_id),
    ledTeamIds,
    ledDepartmentIds,
    isLeader: ledTeamIds.length > 0 || ledDepartmentIds.length > 0,
    isKidsStaff,
    can: (perm) => isStaff || perms.has(perm),
  }
})

/** За всички вътрешни страници: изисква вход, одобрение и (за ръководството) 2FA */
export async function requireMe(): Promise<Me> {
  const me = await getMe()
  if (!me) redirect('/login')
  if (me.profile.status !== 'active') redirect('/pending')
  if (me.needsMfa) redirect('/mfa')
  return me
}

export async function requireAdmin(): Promise<Me> {
  const me = await requireMe()
  if (!me.isAdmin) redirect('/?error=' + encodeURIComponent('Нямате администраторски права'))
  return me
}

export async function requireStaff(): Promise<Me> {
  const me = await requireMe()
  if (!me.isStaff) redirect('/?error=' + encodeURIComponent('Само за ръководството'))
  return me
}

export function fullName(p?: { first_name?: string | null; last_name?: string | null } | null) {
  if (!p) return '—'
  return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || '—'
}

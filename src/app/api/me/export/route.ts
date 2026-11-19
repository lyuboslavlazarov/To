import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** GDPR: човекът изтегля всички свои данни като JSON */
export async function GET() {
  const supabase = await createClient()
  const { data: c } = await supabase.auth.getClaims()
  const id = c?.claims?.sub
  if (!id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const q = (t: string, col = 'profile_id') => supabase.from(t).select('*').eq(col, id)
  const [profile, teams, positions, assignments, availability, blockouts, gifts, notifications, requests] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', id).single(),
    supabase.from('team_members').select('is_leader, joined_at, teams(name)').eq('profile_id', id),
    supabase.from('member_positions').select('positions(name, teams(name))').eq('profile_id', id),
    supabase.from('assignments').select('status, created_at, responded_at, decline_reason, events(title, starts_at), positions(name)').eq('profile_id', id),
    q('availability'), q('blockouts'), q('gifts'), q('notifications'), q('data_requests'),
  ])
  await supabase.from('data_requests').insert({ profile_id: id, kind: 'export', status: 'done', handled_at: new Date().toISOString() })
  const body = JSON.stringify({
    exported_at: new Date().toISOString(),
    profile: profile.data, teams: teams.data, positions: positions.data, assignments: assignments.data,
    availability: availability.data, blockouts: blockouts.data, gifts: gifts.data, notifications: notifications.data, data_requests: requests.data,
  }, null, 2)
  return new NextResponse(body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="moite-danni.json"` },
  })
}

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const icsDate = (d: string) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const esc = (s: string) => s.replace(/[\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n')

/** Моите служения като .ics файл (за Google / Apple календар) */
export async function GET() {
  const supabase = await createClient()
  const { data: c } = await supabase.auth.getClaims()
  const id = c?.claims?.sub
  if (!id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { data } = await supabase.from('assignments')
    .select('id, status, positions(name), teams(name), events!inner(id, title, starts_at, ends_at, rooms(name))')
    .eq('profile_id', id).neq('status', 'declined').gte('events.starts_at', new Date(Date.now() - 30 * 864e5).toISOString())
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? ''
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sluzhenie//BG', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Моите служения']
  for (const a of (data ?? []) as any[]) {
    lines.push('BEGIN:VEVENT', `UID:${a.id}@sluzhenie`, `DTSTAMP:${icsDate(new Date().toISOString())}`,
      `DTSTART:${icsDate(a.events.starts_at)}`, `DTEND:${icsDate(a.events.ends_at)}`,
      `SUMMARY:${esc(`${a.events.title} – ${a.positions?.name}`)}`,
      `DESCRIPTION:${esc(`${a.teams?.name} – ${a.positions?.name}${a.status === 'pending' ? ' (чака потвърждение)' : ''}`)}`,
      ...(a.events.rooms ? [`LOCATION:${esc(a.events.rooms.name)}`] : []),
      `URL:${site}/events/${a.events.id}`, 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return new NextResponse(lines.join('\r\n'), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="sluzhenia.ics"' } })
}

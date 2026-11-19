import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notify'
import { fmtTime, localDay } from '@/lib/format'

/**
 * Ежедневна задача (Vercel Cron, виж vercel.json):
 *  1. Push напомняне ден преди служението
 *  2. Рождени дни днес → ръководството и лидерите
 *  3. Повтарящите се чеклисти за следващите дни
 *  4. Повтарящите се събития – поддържа ги създадени 12 седмици напред
 *  5. GDPR: изтрива личните данни от регистрации за събития отпреди повече от 12 месеца
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const db = createAdminClient()
  const report: Record<string, unknown> = {}

  // 1. Напомняния за утре
  const tomorrow = localDay(new Date(Date.now() + 864e5))
  const { data: tmr } = await db.from('assignments')
    .select('id, profile_id, status, positions(name), teams(name), events!inner(id, title, starts_at, is_cancelled)')
    .in('status', ['pending', 'confirmed']).is('reminded_at', null)
    .gte('events.starts_at', new Date(Date.now()).toISOString())
    .lte('events.starts_at', new Date(Date.now() + 2 * 864e5).toISOString())
  let reminded = 0
  for (const a of (tmr ?? []) as any[]) {
    if (a.events.is_cancelled || localDay(a.events.starts_at) !== tomorrow) continue
    await notify([a.profile_id], {
      title: a.status === 'pending' ? 'Утре служите – потвърдете' : 'Напомняне: утре служите',
      body: `${a.events.title} в ${fmtTime(a.events.starts_at)} · ${a.teams?.name} – ${a.positions?.name}`,
      url: `/events/${a.events.id}`, tag: 'reminder-' + a.id,
    }, { inApp: false })
    await db.from('assignments').update({ reminded_at: new Date().toISOString() }).eq('id', a.id)
    reminded++
  }
  report.reminders = reminded

  // 2. Рождени дни днес
  const today = localDay()
  const md = today.slice(5)
  const { data: people } = await db.from('profiles').select('id, first_name, last_name, birthday').eq('status', 'active').not('birthday', 'is', null)
  const bdays = (people ?? []).filter((p) => p.birthday!.slice(5) === md)
  if (bdays.length) {
    const { data: staff } = await db.from('profiles').select('id').eq('status', 'active').in('system_role', ['leadership'])
    for (const p of bdays) {
      const { data: teams } = await db.from('team_members').select('team_id').eq('profile_id', p.id)
      const tids = (teams ?? []).map((t) => t.team_id)
      const { data: leaders } = tids.length ? await db.from('team_members').select('profile_id').in('team_id', tids).eq('is_leader', true) : { data: [] }
      const to = [...(staff ?? []).map((s) => s.id), ...(leaders ?? []).map((l: any) => l.profile_id)].filter((x) => x !== p.id)
      await notify(to, { title: `🎂 Рожден ден: ${p.first_name} ${p.last_name}`, body: 'Не забравяйте да поздравите!', url: `/people/${p.id}` })
    }
  }
  report.birthdays = bdays.length

  // 3. Чеклисти
  const { data: cl } = await db.rpc('generate_due_checklists', { p_days_ahead: 7 })
  report.checklists = cl

  // 4. Повтарящи се събития
  const { data: series } = await db.from('event_series').select('id')
  let created = 0
  const until = localDay(new Date(Date.now() + 84 * 864e5))
  for (const s of series ?? []) {
    const { data: n } = await db.rpc('generate_series_events', { p_series: s.id, p_until: until })
    created += n ?? 0
  }
  report.series_events = created

  // 5. GDPR – стари регистрации
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString()
  const { data: old } = await db.from('reg_events').select('id').lt('starts_at', yearAgo)
  if (old?.length) {
    const { count } = await db.from('registrations').delete({ count: 'exact' }).in('reg_event_id', old.map((o) => o.id))
    report.gdpr_deleted_registrations = count
  }

  return NextResponse.json({ ok: true, ...report })
}

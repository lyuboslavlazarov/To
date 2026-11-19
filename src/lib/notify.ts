import 'server-only'
import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail, emailLayout, esc } from '@/lib/email'

let vapidReady = false
function initVapid() {
  if (vapidReady) return true
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return false
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com', pub, priv)
  vapidReady = true
  return true
}

export type Note = { title: string; body?: string; url?: string; tag?: string }

/**
 * Известие до хора: запис в „Известия“ + Web Push (+ имейл по избор).
 * Вика се от server actions СЛЕД като правата са проверени от RLS.
 */
export async function notify(profileIds: string[], n: Note, opts: { inApp?: boolean; push?: boolean; email?: boolean } = {}) {
  const ids = [...new Set(profileIds.filter(Boolean))]
  if (!ids.length || !process.env.SUPABASE_SERVICE_ROLE_KEY) return
  const { inApp = true, push = true, email = false } = opts
  const admin = createAdminClient()
  try {
    if (inApp) {
      await admin.from('notifications').insert(ids.map((profile_id) => ({ profile_id, title: n.title, body: n.body ?? null, url: n.url ?? null })))
    }
    if (push) await sendPush(ids, n)
    if (email) {
      const { data } = await admin.from('profiles').select('email').in('id', ids).eq('status', 'active')
      const site = process.env.NEXT_PUBLIC_SITE_URL ?? ''
      for (const p of data ?? []) {
        await sendEmail({
          to: p.email,
          subject: n.title,
          html: emailLayout(esc(n.title), `<p style="white-space:pre-line">${esc(n.body)}</p>${n.url ? `<p><a href="${site}${n.url}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none">Отвори</a></p>` : ''}`),
        })
      }
    }
  } catch (e) {
    console.error('[notify]', e)
  }
}

export async function sendPush(profileIds: string[], n: Note) {
  if (!initVapid()) return
  const admin = createAdminClient()
  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('profile_id', profileIds)
  const payload = JSON.stringify({ title: n.title, body: n.body ?? '', url: n.url ?? '/', tag: n.tag })
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 })
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', s.id)
      }
    })
  )
}

/** Лидерите на екип (вкл. лидерите на отдела) */
export async function teamLeaderIds(teamId: string) {
  const admin = createAdminClient()
  const [{ data: tl }, { data: team }] = await Promise.all([
    admin.from('team_members').select('profile_id').eq('team_id', teamId).eq('is_leader', true),
    admin.from('teams').select('department_id').eq('id', teamId).single(),
  ])
  const { data: dl } = team ? await admin.from('department_leaders').select('profile_id').eq('department_id', team.department_id) : { data: [] }
  return [...new Set([...(tl ?? []), ...(dl ?? [])].map((r: any) => r.profile_id))]
}

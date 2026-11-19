import 'server-only'

type Attachment = { filename: string; content: string /* base64 */; content_id?: string }

/** Изпраща имейл през Resend (https://resend.com). Без ключ – само записва в лога. */
export async function sendEmail({ to, subject, html, attachments }: { to: string | string[]; subject: string; html: string; attachments?: Attachment[] }) {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.warn('[email] Няма RESEND_API_KEY – имейлът не е изпратен:', subject, to)
    return { ok: false }
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? 'Служение <onboarding@resend.dev>', to, subject, html, attachments }),
  })
  if (!res.ok) console.error('[email] Грешка:', res.status, await res.text())
  return { ok: res.ok }
}

export function emailLayout(title: string, body: string) {
  return `<!doctype html><html lang="bg"><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:16px;padding:24px;border:1px solid #e2e8f0">
      <h1 style="font-size:20px;margin:0 0 16px">${title}</h1>
      ${body}
    </div>
    <p style="color:#64748b;font-size:12px;text-align:center;margin-top:16px">Това съобщение е изпратено автоматично.</p>
  </div></body></html>`
}

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

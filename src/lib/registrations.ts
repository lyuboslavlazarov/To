import 'server-only'
import QRCode from 'qrcode'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail, emailLayout, esc } from '@/lib/email'
import { fmtDateTime } from '@/lib/format'

const site = () => process.env.NEXT_PUBLIC_SITE_URL ?? ''

export async function qrDataUrl(text: string, size = 320) {
  return QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M' })
}

/** Имейл с потвърждение / място в списъка на изчакване / освободено място */
export async function sendRegistrationEmail(registrationId: string, kind: 'confirmed' | 'waitlist' | 'promoted') {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return
  const db = createAdminClient()
  const { data: r } = await db.from('registrations').select('*, reg_events(title, starts_at, location, confirmation_text)').eq('id', registrationId).single()
  if (!r) return
  const e: any = r.reg_events
  const ticketUrl = `${site()}/r/ticket/${r.qr_token}`
  const cancelUrl = `${site()}/r/cancel/${r.cancel_token}`
  const seat = r.seat_row ? `<p style="font-size:16px"><b>Място:</b> ред ${r.seat_row}, място ${r.seat_number}</p>` : ''
  const when = `<p><b>${esc(e.title)}</b><br>${e.starts_at ? fmtDateTime(e.starts_at) : ''}${e.location ? ' · ' + esc(e.location) : ''}</p>`
  let title = '', body = '', attachments: any[] | undefined
  if (kind === 'waitlist') {
    title = 'Вие сте в списъка на изчакване'
    body = `<p>Здравейте, ${esc(r.first_name)}!</p>${when}<p>В момента всички места са заети и сте в <b>списъка на изчакване</b>. Ако се освободи място, ще го получите автоматично и ще ви пратим имейл с билет.</p>
      <p style="font-size:13px;color:#64748b">Ако вече не желаете да присъствате: <a href="${cancelUrl}">откажете регистрацията</a>.</p>`
  } else {
    title = kind === 'promoted' ? '🎉 Освободи се място – вие сте вътре!' : 'Регистрацията е потвърдена'
    const png = (await qrDataUrl(r.qr_token, 400)).split(',')[1]
    attachments = [{ filename: 'bilet-qr.png', content: png, content_id: 'qr' }]
    body = `<p>Здравейте, ${esc(r.first_name)}!</p>${when}${seat}
      ${e.confirmation_text ? `<p style="white-space:pre-line">${esc(e.confirmation_text)}</p>` : ''}
      <p>Покажете този QR код на входа:</p>
      <p style="text-align:center"><img src="cid:qr" width="220" height="220" alt="QR код" style="border:8px solid #fff"></p>
      <p style="text-align:center"><a href="${ticketUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none">Отвори билета</a></p>
      <p style="font-size:13px;color:#64748b">Не можете да дойдете? <a href="${cancelUrl}">Откажете регистрацията</a>, за да освободите мястото за някой от списъка на изчакване.</p>`
  }
  await sendEmail({ to: r.email, subject: `${title}: ${e.title}`, html: emailLayout(title, body), attachments })
}

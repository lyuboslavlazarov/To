import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendPush } from '@/lib/notify'

async function uid() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  return { supabase, id: data?.claims?.sub as string | undefined }
}

export async function POST(req: NextRequest) {
  const { supabase, id } = await uid()
  if (!id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sub = await req.json()
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return NextResponse.json({ error: 'bad' }, { status: 400 })
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  const { error } = await supabase.from('push_subscriptions').insert({
    profile_id: id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: req.headers.get('user-agent')?.slice(0, 200),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { supabase, id } = await uid()
  if (!id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { endpoint } = await req.json()
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  return NextResponse.json({ ok: true })
}

export async function PUT() {
  const { id } = await uid()
  if (!id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await sendPush([id], { title: 'Тестово известие', body: 'Push известията работят 🎉', url: '/profile' })
  return NextResponse.json({ ok: true })
}

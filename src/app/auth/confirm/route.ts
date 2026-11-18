import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

// Линк от имейл шаблон: {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const token_hash = url.searchParams.get('token_hash')
  const type = (url.searchParams.get('type') ?? 'email') as EmailOtpType
  const next = url.searchParams.get('next') ?? '/'
  if (token_hash) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) return NextResponse.redirect(new URL(next.startsWith('/') ? next : '/', url.origin))
  }
  return NextResponse.redirect(new URL('/login?error=' + encodeURIComponent('Линкът е невалиден или изтекъл.'), url.origin))
}

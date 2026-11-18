import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PREFIXES = ['/login', '/auth', '/r/', '/privacy', '/offline', '/api/cron', '/manifest', '/sw.js', '/icons']

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return response

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  // опреснява сесията (важно – не премахвайте)
  const { data } = await supabase.auth.getClaims()
  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PREFIXES.some((p) => path.startsWith(p))

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)'],
}

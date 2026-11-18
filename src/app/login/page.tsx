import { LoginForm } from './login-form'
import { ThemeToggle } from '@/components/theme-toggle'

export const metadata = { title: 'Вход' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams
  return (
    <main className="pt-safe mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl font-black text-white">С</div>
        <h1 className="text-2xl font-bold">Служение</h1>
        <p className="muted mt-1 text-sm">Графици, екипи и събития на едно място</p>
      </div>
      <LoginForm next={sp.next && sp.next.startsWith('/') ? sp.next : '/'} initialError={sp.error} />
    </main>
  )
}

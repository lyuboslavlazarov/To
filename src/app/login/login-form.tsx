'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [info, setInfo] = useState<string | null>(null)

  async function sendLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true); setError(null)
    const fd = new FormData(e.currentTarget)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: mode === 'register',
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        data: mode === 'register'
          ? { first_name: String(fd.get('first_name') ?? '').trim(), last_name: String(fd.get('last_name') ?? '').trim(), phone: String(fd.get('phone') ?? '').trim(), gdpr_consent: fd.get('consent') === 'on' ? 'true' : 'false' }
          : undefined,
      },
    })
    setBusy(false)
    if (error) {
      setError(/signups not allowed|not found|Signups/i.test(error.message)
        ? 'Няма профил с този имейл. Натиснете „Нов съм тук“, за да се регистрирате.'
        : /rate|seconds/i.test(error.message) ? 'Твърде много опити. Изчакайте минута и опитайте пак.' : error.message)
      return
    }
    setStep('code')
    setInfo('Изпратихме ви имейл. Натиснете линка в него или въведете кода тук.')
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) { setError('Невалиден или изтекъл код. Опитайте отново.'); return }
    router.replace(next)
    router.refresh()
  }

  return (
    <div className="card p-5 sm:p-6">
      {step === 'email' ? (
        <form onSubmit={sendLink} className="space-y-4">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {(['login', 'register'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`rounded-lg py-2 text-sm font-medium ${mode === m ? 'bg-white shadow-sm dark:bg-slate-900' : 'text-slate-500'}`}>
                {m === 'login' ? 'Вход' : 'Нов съм тук'}
              </button>
            ))}
          </div>
          {mode === 'register' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label><span className="label">Име</span><input name="first_name" required className="input" autoComplete="given-name" /></label>
                <label><span className="label">Фамилия</span><input name="last_name" required className="input" autoComplete="family-name" /></label>
              </div>
              <label className="block"><span className="label">Телефон</span><input name="phone" type="tel" className="input" autoComplete="tel" /></label>
            </>
          )}
          <label className="block">
            <span className="label">Имейл</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" autoComplete="email" inputMode="email" placeholder="ime@primer.bg" />
          </label>
          {mode === 'register' && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="consent" required className="mt-1" />
              <span>Съгласен/на съм данните ми да се обработват според <Link href="/privacy" className="text-brand-600 underline" target="_blank">политиката за поверителност</Link>.</span>
            </label>
          )}
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Изпращане…' : mode === 'login' ? 'Изпрати ми линк за вход' : 'Регистрирай ме'}</button>
          <p className="muted text-center text-xs">Без пароли – получавате линк и код на имейла си.</p>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          {info && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">{info}</p>}
          <label className="block">
            <span className="label">Код от имейла</span>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} inputMode="numeric" autoComplete="one-time-code"
              maxLength={8} className="input text-center text-2xl tracking-[.4em]" placeholder="••••••" autoFocus />
          </label>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button className="btn-primary w-full" disabled={busy || code.length < 6}>{busy ? 'Проверка…' : 'Влез'}</button>
          <button type="button" className="btn-ghost w-full" onClick={() => { setStep('email'); setCode(''); setError(null) }}>Друг имейл</button>
          <p className="muted text-center text-xs">На iPhone: ако сте инсталирали приложението, въведете кода тук – линкът се отваря в Safari.</p>
        </form>
      )}
    </div>
  )
}

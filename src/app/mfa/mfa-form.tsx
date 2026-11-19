'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function MfaForm() {
  const router = useRouter()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const supabase = createClient()
      const { data } = await supabase.auth.mfa.listFactors()
      const verified = data?.totp?.find((f) => f.status === 'verified')
      if (verified) {
        setFactorId(verified.id)
      } else {
        // премахваме недовършени опити и започваме ново записване
        for (const f of data?.all ?? []) if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
        const { data: en, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Приложение ' + Date.now() })
        if (error) setError(error.message)
        else { setFactorId(en.id); setQr(en.totp.qr_code); setSecret(en.totp.secret) }
      }
      setLoading(false)
    })()
  }, [])

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    if (!factorId) return
    setBusy(true); setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
    setBusy(false)
    if (error) { setError('Грешен код. Опитайте с новия код от приложението.'); return }
    router.replace('/')
    router.refresh()
  }

  if (loading) return <div className="card p-6 text-center text-sm">Зареждане…</div>
  return (
    <form onSubmit={verify} className="card space-y-4 p-5">
      {qr ? (
        <>
          <p className="text-sm"><b>1.</b> Сканирайте QR кода с приложението за автентикация:</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR код за 2FA" className="mx-auto h-48 w-48 rounded-xl bg-white p-2" />
          <p className="muted break-all text-center text-xs">или въведете ключа ръчно: <code>{secret}</code></p>
          <p className="text-sm"><b>2.</b> Въведете 6-цифрения код от приложението:</p>
        </>
      ) : (
        <p className="text-sm">Въведете 6-цифрения код от приложението за автентикация:</p>
      )}
      <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} inputMode="numeric" autoComplete="one-time-code"
        maxLength={6} className="input text-center text-2xl tracking-[.4em]" placeholder="••••••" autoFocus />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button className="btn-primary w-full" disabled={busy || code.length !== 6}>{busy ? 'Проверка…' : 'Потвърди'}</button>
    </form>
  )
}

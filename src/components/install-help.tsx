'use client'
import { useEffect, useState } from 'react'

export function InstallHelp() {
  const [prompt, setPrompt] = useState<any>(null)
  const [installed, setInstalled] = useState(false)
  const [ios, setIos] = useState(false)
  useEffect(() => {
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent))
    setInstalled(window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true)
    const h = (e: any) => { e.preventDefault(); setPrompt(e) }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])
  if (installed) return <p className="text-sm text-emerald-600">✓ Приложението е инсталирано.</p>
  if (prompt) return <button className="btn-primary btn-sm" onClick={() => prompt.prompt()}>📲 Инсталирай приложението</button>
  return ios ? (
    <p className="text-sm">В <b>Safari</b> натиснете <b>Сподели</b> (квадратчето със стрелка) → <b>Добави към началния екран</b> → <b>Добави</b>.</p>
  ) : (
    <p className="text-sm">В <b>Chrome</b> отворете менюто <b>⋮</b> → <b>Инсталиране на приложението</b> (или „Добавяне към началния екран“).</p>
  )
}

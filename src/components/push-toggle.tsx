'use client'
import { useEffect, useState } from 'react'

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function PushToggle() {
  const [state, setState] = useState<'loading' | 'unsupported' | 'ios-install' | 'off' | 'on' | 'denied'>('loading')
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setState(isIOS && !standalone ? 'ios-install' : 'unsupported'); return
      }
      if (Notification.permission === 'denied') { setState('denied'); return }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      setState(sub ? 'on' : 'off')
    })()
  }, [])

  async function enable() {
    setMsg(null)
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!key) { setMsg('Push известията още не са настроени от администратора (VAPID ключ).'); return }
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') { setState('denied'); return }
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
    const res = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) })
    if (res.ok) { setState('on'); setMsg('Известията са включени ✓') } else setMsg('Грешка при включване')
  }

  async function disable() {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await fetch('/api/push/subscribe', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) })
      await sub.unsubscribe()
    }
    setState('off')
  }

  async function test() {
    const res = await fetch('/api/push/subscribe?test=1', { method: 'PUT' })
    setMsg(res.ok ? 'Изпратено – трябва да получите известие.' : 'Грешка')
  }

  return (
    <div className="space-y-2 text-sm">
      {state === 'loading' && <p className="muted">Проверка…</p>}
      {state === 'unsupported' && <p className="muted">Този браузър не поддържа push известия.</p>}
      {state === 'ios-install' && <p>На iPhone известията работят, след като добавите приложението на началния екран: <b>Сподели → Добави към началния екран</b>, после го отворете оттам.</p>}
      {state === 'denied' && <p className="text-amber-600">Известията са блокирани в настройките на браузъра/телефона. Разрешете ги оттам.</p>}
      {state === 'off' && <button onClick={enable} className="btn-primary btn-sm">🔔 Включи известията на това устройство</button>}
      {state === 'on' && (
        <div className="flex flex-wrap gap-2">
          <span className="text-emerald-600">✓ Включени на това устройство</span>
          <button onClick={test} className="btn-secondary btn-sm">Тест</button>
          <button onClick={disable} className="btn-ghost btn-sm">Изключи</button>
        </div>
      )}
      {msg && <p className="muted">{msg}</p>}
    </div>
  )
}

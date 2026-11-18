'use client'
import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

type Result = { ok: boolean; message: string; name?: string; title?: string; seat_row?: number; seat_number?: number }

/** Сканиране на QR с камерата (BarcodeDetector, ако го има, иначе jsQR) */
export function QrScanner({ onScan }: { onScan: (code: string) => Promise<Result> }) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const busy = useRef(false)
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  const [result, setResult] = useState<Result | null>(null)
  const [camErr, setCamErr] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const [count, setCount] = useState(0)

  async function handle(code: string) {
    if (busy.current) return
    const now = Date.now()
    if (code === last.current.code && now - last.current.at < 4000) return
    busy.current = true
    last.current = { code, at: now }
    const r = await onScan(code)
    setResult(r)
    if (r.ok) setCount((c) => c + 1)
    try { navigator.vibrate?.(r.ok ? 80 : [80, 60, 80]) } catch {}
    setTimeout(() => { busy.current = false }, 1500)
  }

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    const Detector = (window as any).BarcodeDetector
    const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (!video.current) return
        video.current.srcObject = stream
        await video.current.play()
        const tick = async () => {
          if (stopped || !video.current) return
          const v = video.current
          if (v.readyState >= 2 && !busy.current) {
            try {
              if (detector) {
                const codes = await detector.detect(v)
                if (codes[0]?.rawValue) await handle(codes[0].rawValue)
              } else if (canvas.current) {
                const c = canvas.current
                c.width = v.videoWidth; c.height = v.videoHeight
                const ctx = c.getContext('2d', { willReadFrequently: true })!
                ctx.drawImage(v, 0, 0)
                const img = ctx.getImageData(0, 0, c.width, c.height)
                const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
                if (code?.data) await handle(code.data)
              }
            } catch {}
          }
          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch (e: any) {
        setCamErr('Няма достъп до камерата. Разрешете камерата в браузъра или въведете кода ръчно.')
      }
    })()
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-3">
      <div className="relative mx-auto aspect-square max-w-md overflow-hidden rounded-2xl bg-black">
        <video ref={video} playsInline muted className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-[15%] rounded-2xl border-4 border-white/70" />
        {camErr && <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">{camErr}</p>}
      </div>
      <canvas ref={canvas} className="hidden" />
      {result && (
        <div className={`mx-auto max-w-md rounded-2xl p-5 text-center text-white ${result.ok ? 'bg-emerald-600' : 'bg-rose-600'}`}>
          <div className="text-3xl">{result.ok ? '✓' : '✕'}</div>
          <div className="text-xl font-bold">{result.message}</div>
          {result.name && <div className="mt-1 text-lg">{result.name}</div>}
          {result.seat_row && <div className="mt-1 text-2xl font-bold">Ред {result.seat_row} · Място {result.seat_number}</div>}
          {result.title && <div className="text-sm opacity-90">{result.title}</div>}
        </div>
      )}
      <form className="mx-auto flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); if (manual) { last.current.code = ''; handle(manual); setManual('') } }}>
        <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="или въведете кода от билета" className="input" />
        <button className="btn-secondary">Провери</button>
      </form>
      <p className="muted text-center text-xs">Пуснати в тази сесия: {count}</p>
    </div>
  )
}

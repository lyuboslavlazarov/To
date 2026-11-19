'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resizeImage } from './avatar-upload'

/** Качва снимка (от камерата на телефона) в task-photos и вика onUploaded(path) */
export function PhotoUpload({ folder, label = '📷 Снимка', onUploaded, inputName }: {
  folder: string; label?: string; onUploaded?: (path: string) => Promise<{ error?: string } | null | undefined | void>; inputName?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [path, setPath] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setBusy(true); setErr(null)
    try {
      const blob = await resizeImage(f, 1600)
      const p = `${folder}/${crypto.randomUUID()}.jpg`
      const { error } = await createClient().storage.from('task-photos').upload(p, blob, { contentType: 'image/jpeg' })
      if (error) throw error
      setPath(p)
      const r = await onUploaded?.(p)
      if (r && r.error) setErr(r.error)
      router.refresh()
    } catch (e: any) { setErr(e?.message ?? 'Грешка') }
    setBusy(false)
  }
  return (
    <span className="inline-flex items-center gap-2">
      {inputName && <input type="hidden" name={inputName} value={path ?? ''} />}
      <label className="btn-secondary btn-sm cursor-pointer">{busy ? 'Качване…' : path && inputName ? '✓ Снимката е добавена' : label}
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} disabled={busy} />
      </label>
      {err && <span className="text-xs text-rose-600">{err}</span>}
    </span>
  )
}

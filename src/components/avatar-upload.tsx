'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { setAvatar } from '@/app/(app)/profile/actions'

/** Намалява снимката в браузъра (до 512px) и я качва в Supabase Storage */
export function AvatarUpload({ userId }: { userId: string }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setMsg(null)
    try {
      const blob = await resizeImage(file, 512)
      const supabase = createClient()
      const path = `${userId}/avatar-${Date.now()}.jpg`
      const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: true })
      if (error) throw error
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      const r = await setAvatar(data.publicUrl)
      setMsg(r?.error ?? r?.ok ?? null)
    } catch (err: any) {
      setMsg('Грешка: ' + (err?.message ?? err))
    }
    setBusy(false)
  }
  return (
    <div>
      <label className="btn-secondary btn-sm cursor-pointer">
        {busy ? 'Качване…' : 'Смени снимката'}
        <input type="file" accept="image/*" className="hidden" onChange={onFile} disabled={busy} />
      </label>
      {msg && <p className="muted mt-1 text-xs">{msg}</p>}
    </div>
  )
}

export async function resizeImage(file: File, max: number): Promise<Blob> {
  const img = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Неуспешно'))), 'image/jpeg', 0.85))
}

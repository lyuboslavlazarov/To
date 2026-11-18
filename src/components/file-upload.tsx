'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { registerPlanFile } from '@/app/(app)/events/actions'

export function PlanFileUpload({ eventId, teamId }: { eventId: string; teamId: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 25 * 1024 * 1024) { setMsg('Файлът е над 25 MB'); return }
    setBusy(true); setMsg(null)
    const safe = file.name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-80)
    const path = `${eventId}/${teamId ?? 'general'}/${Date.now()}-${safe}`
    const supabase = createClient()
    const { error } = await supabase.storage.from('plan-files').upload(path, file, { contentType: file.type || undefined })
    if (error) { setMsg('Грешка: ' + error.message); setBusy(false); return }
    const r = await registerPlanFile(eventId, teamId, file.name, path)
    setMsg(r?.error ?? null)
    setBusy(false)
    router.refresh()
    e.target.value = ''
  }
  return (
    <span>
      <label className="btn-secondary btn-sm cursor-pointer">{busy ? 'Качване…' : '+ Файл'}<input type="file" className="hidden" onChange={onFile} disabled={busy} /></label>
      {msg && <span className="ml-2 text-xs text-rose-600">{msg}</span>}
    </span>
  )
}

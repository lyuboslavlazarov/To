'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/** Обновява страницата при промяна в таблица (Supabase Realtime, спазва RLS) */
export function LiveRefresh({ table, filter, channel }: { table: string; filter?: string; channel: string }) {
  const router = useRouter()
  useEffect(() => {
    const supabase = createClient()
    let t: any
    const ch = supabase
      .channel(channel)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => {
        clearTimeout(t)
        t = setTimeout(() => router.refresh(), 300)
      })
      .subscribe()
    return () => { clearTimeout(t); supabase.removeChannel(ch) }
  }, [table, filter, channel, router])
  return null
}

'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sendChat } from '@/app/(app)/messages/actions'

type Msg = { id: string; author_id: string | null; author_name: string | null; body: string; created_at: string }

export function TeamChat({ teamId, meId, initial }: { teamId: string; meId: string; initial: Msg[] }) {
  const [msgs, setMsgs] = useState<Msg[]>(initial)
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const supabase = createClient()
    const ch = supabase.channel('chat-' + teamId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_messages', filter: `team_id=eq.${teamId}` }, (p) => {
        setMsgs((m) => (m.some((x) => x.id === (p.new as Msg).id) ? m : [...m, p.new as Msg]))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'team_messages' }, (p) => {
        setMsgs((m) => m.filter((x) => x.id !== (p.old as Msg).id))
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [teamId])
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs.length])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const body = text
    if (!body.trim()) return
    setText(''); setErr(null)
    const r = await sendChat(teamId, body)
    if (r?.error) { setErr(r.error); setText(body) }
  }

  const time = (d: string) => new Date(d).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="card flex h-[calc(100dvh-16rem)] min-h-96 flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {!msgs.length && <p className="muted text-center text-sm">Още няма съобщения. Напишете първото!</p>}
        {msgs.map((m) => {
          const mine = m.author_id === meId
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? 'rounded-br-sm bg-brand-600 text-white' : 'rounded-bl-sm bg-slate-100 dark:bg-slate-800'}`}>
                {!mine && <div className="text-xs font-semibold text-brand-600 dark:text-brand-200">{m.author_name}</div>}
                <div className="whitespace-pre-line break-words">{m.body}</div>
                <div className={`mt-0.5 text-[10px] ${mine ? 'text-white/70' : 'muted'}`}>{time(m.created_at)}</div>
              </div>
            </div>
          )
        })}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-slate-200 p-3 dark:border-slate-800">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Съобщение…" className="input" maxLength={4000} />
        <button className="btn-primary">Изпрати</button>
      </form>
      {err && <p className="px-3 pb-2 text-xs text-rose-600">{err}</p>}
    </div>
  )
}

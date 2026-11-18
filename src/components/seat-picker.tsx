'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/** Схема на залата: редове × места. Заетите места се опресняват на всеки 10 секунди. */
export function SeatPicker({ slug, rows, perRow, blocked, initialTaken, name = 'seat' }: {
  slug: string; rows: number; perRow: number; blocked: string[]; initialTaken: string[]; name?: string
}) {
  const [taken, setTaken] = useState<Set<string>>(new Set(initialTaken))
  const [sel, setSel] = useState<string | null>(null)
  useEffect(() => {
    const supabase = createClient()
    const t = setInterval(async () => {
      const { data } = await supabase.rpc('reg_taken_seats', { p_slug: slug })
      if (data) {
        const s = new Set<string>((data as any[]).map((x) => `${x.seat_row}-${x.seat_number}`))
        setTaken(s)
        setSel((cur) => (cur && s.has(cur) ? null : cur))
      }
    }, 10000)
    return () => clearInterval(t)
  }, [slug])
  const block = new Set(blocked)
  return (
    <div>
      <input type="hidden" name={name} value={sel ?? ''} />
      <div className="overflow-x-auto rounded-2xl bg-slate-50 p-3 dark:bg-slate-900">
        <div className="mx-auto mb-4 w-2/3 rounded-b-xl bg-slate-300 py-1 text-center text-xs font-semibold tracking-widest text-slate-600 dark:bg-slate-700 dark:text-slate-300">СЦЕНА</div>
        <div className="inline-block min-w-full">
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className="mb-1 flex items-center justify-center gap-1">
              <span className="w-5 text-right text-[10px] text-slate-400">{r + 1}</span>
              {Array.from({ length: perRow }, (_, n) => {
                const id = `${r + 1}-${n + 1}`
                const isBlocked = block.has(id)
                const isTaken = taken.has(id)
                const isSel = sel === id
                return (
                  <button key={id} type="button" disabled={isBlocked || isTaken} onClick={() => setSel(isSel ? null : id)}
                    title={`Ред ${r + 1}, място ${n + 1}`} aria-label={`Ред ${r + 1}, място ${n + 1}`}
                    className={`h-6 w-6 shrink-0 rounded-t-lg text-[9px] font-medium transition sm:h-7 sm:w-7 ${
                      isBlocked ? 'invisible' : isSel ? 'bg-brand-600 text-white ring-2 ring-brand-300' : isTaken ? 'cursor-not-allowed bg-slate-300 text-slate-400 dark:bg-slate-700' : 'bg-emerald-200 text-emerald-900 hover:bg-emerald-300 dark:bg-emerald-800 dark:text-emerald-100'}`}>
                    {n + 1}
                  </button>
                )
              })}
              <span className="w-5 text-[10px] text-slate-400">{r + 1}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-emerald-200" />свободно</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-slate-300" />заето</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-brand-600" />вашето</span>
        <span className="ml-auto font-semibold">{sel ? `Избрано: ред ${sel.split('-')[0]}, място ${sel.split('-')[1]}` : 'Изберете място'}</span>
      </div>
    </div>
  )
}

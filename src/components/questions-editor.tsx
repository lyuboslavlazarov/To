'use client'
import { useState } from 'react'

type Q = { id: string; label: string; type: 'text' | 'textarea' | 'select' | 'checkbox'; options: string[]; required: boolean }

export function QuestionsEditor({ initial }: { initial: Q[] }) {
  const [qs, setQs] = useState<Q[]>(initial)
  const upd = (i: number, patch: Partial<Q>) => setQs(qs.map((q, k) => (k === i ? { ...q, ...patch } : q)))
  return (
    <div className="space-y-2">
      <input type="hidden" name="questions" value={JSON.stringify(qs)} />
      {qs.map((q, i) => (
        <div key={q.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <div className="flex flex-wrap gap-2">
            <input value={q.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="Въпрос" className="input flex-1" />
            <select value={q.type} onChange={(e) => upd(i, { type: e.target.value as Q['type'] })} className="input w-auto">
              <option value="text">Кратък отговор</option><option value="textarea">Дълъг отговор</option>
              <option value="select">Избор от списък</option><option value="checkbox">Отметка (да/не)</option>
            </select>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={q.required} onChange={(e) => upd(i, { required: e.target.checked })} />задължителен</label>
            <button type="button" className="btn-ghost btn-sm text-rose-600" onClick={() => setQs(qs.filter((_, k) => k !== i))}>✕</button>
          </div>
          {q.type === 'select' && (
            <input value={q.options.join(', ')} onChange={(e) => upd(i, { options: e.target.value.split(',').map((s) => s.trimStart()) })}
              placeholder="Възможности, разделени със запетая" className="input mt-2" />
          )}
        </div>
      ))}
      <button type="button" className="btn-secondary btn-sm"
        onClick={() => setQs([...qs, { id: 'q' + Date.now().toString(36), label: '', type: 'text', options: [], required: false }])}>+ Въпрос</button>
    </div>
  )
}

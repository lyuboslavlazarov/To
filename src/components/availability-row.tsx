'use client'
import { useOptimistic, useTransition } from 'react'
import { setAvailability } from '@/app/(app)/events/actions'

type Team = { id: string; name: string; needed: boolean }

export function AvailabilityRow({ eventId, teams, initial, cannot, locked }: {
  eventId: string; teams: Team[]; initial: string[]; cannot: boolean; locked: boolean
}) {
  const [pending, start] = useTransition()
  const [state, setState] = useOptimistic({ on: initial, cannot }, (s, a: { team: string | null; on: boolean }) =>
    a.team === null
      ? { on: a.on ? [] : s.on, cannot: a.on }
      : { cannot: a.on ? false : s.cannot, on: a.on ? [...s.on, a.team] : s.on.filter((x) => x !== a.team) })

  const toggle = (team: string | null, on: boolean) =>
    start(async () => {
      setState({ team, on })
      const r = await setAvailability(eventId, team, on)
      if (r?.error) alert(r.error)
    })

  return (
    <div className={`flex flex-wrap gap-1.5 ${pending ? 'opacity-70' : ''}`}>
      {teams.map((t) => {
        const on = state.on.includes(t.id)
        return (
          <button key={t.id} type="button" disabled={locked} onClick={() => toggle(t.id, !on)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${on ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400'} ${t.needed ? '' : 'border-dashed'}`}>
            {on ? '✓ ' : ''}{t.name}
          </button>
        )
      })}
      <button type="button" disabled={locked} onClick={() => toggle(null, !state.cannot)}
        className={`rounded-full border px-3 py-1 text-xs font-medium ${state.cannot ? 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' : 'border-slate-300 text-slate-500 dark:border-slate-700'}`}>
        {state.cannot ? '✕ Не мога' : 'Не мога'}
      </button>
    </div>
  )
}

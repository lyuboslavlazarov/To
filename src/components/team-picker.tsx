import type { Dept } from '@/lib/data'

/** Чекбоксове за избор на екипи, групирани по отдели */
export function TeamPicker({ depts, name = 'teams', selected = [] }: { depts: Dept[]; name?: string; selected?: string[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {depts.map((d) => (
        <fieldset key={d.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide" style={{ color: d.color }}>{d.name}</legend>
          <div className="space-y-1">
            {d.teams.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={name} value={t.id} defaultChecked={selected.includes(t.id)} />
                {t.name}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  )
}

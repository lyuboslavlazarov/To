import Link from 'next/link'
import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link href={back} className="mb-1 inline-block text-sm text-brand-600 hover:underline dark:text-brand-200">
            ← Назад
          </Link>
        )}
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="muted mt-1 text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ children, className = '', title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

const BADGE: Record<string, string> = {
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  yellow: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  red: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
  blue: 'bg-brand-100 text-brand-700 dark:bg-brand-700/30 dark:text-brand-200',
}
export function Badge({ children, color = 'gray' }: { children: ReactNode; color?: keyof typeof BADGE | string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[color] ?? BADGE.gray}`}>{children}</span>
}

export function statusColor(s: string) {
  return ({ confirmed: 'green', pending: 'yellow', declined: 'red', waitlist: 'yellow', cancelled: 'red', done: 'green', open: 'blue', in_progress: 'yellow' } as Record<string, string>)[s] ?? 'gray'
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700">
      {icon && <div className="mb-2 text-slate-400">{icon}</div>}
      {children}
    </div>
  )
}

export function Avatar({ p, size = 36 }: { p: { first_name?: string | null; last_name?: string | null; avatar_url?: string | null } | null | undefined; size?: number }) {
  const initials = `${p?.first_name?.[0] ?? ''}${p?.last_name?.[0] ?? ''}`.toUpperCase() || '?'
  if (p?.avatar_url)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={p.avatar_url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700 dark:bg-brand-700/30 dark:text-brand-200"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </span>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="muted mt-1 block text-xs">{hint}</span>}
    </label>
  )
}

export function Stat({ label, value, href, tone = 'default' }: { label: string; value: ReactNode; href?: string; tone?: 'default' | 'warn' | 'ok' }) {
  const color = tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : ''
  const inner = (
    <div className="card p-4">
      <div className="muted text-xs font-medium uppercase tracking-wide">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
    </div>
  )
  return href ? <Link href={href} className="block hover:opacity-90">{inner}</Link> : inner
}

export function Flash({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (!error && !ok) return null
  return (
    <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${error ? 'bg-rose-50 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'}`}>
      {error ?? ok}
    </div>
  )
}

export function Tabs({ tabs, active }: { tabs: { href: string; label: string; key: string }[]; active: string }) {
  return (
    <div className="no-print mb-4 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${t.key === active ? 'bg-white shadow-sm dark:bg-slate-800' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}

'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  Baby, BarChart3, Bell, Building2, CalendarDays, CalendarCheck, CheckSquare, ClipboardList, Home, Megaphone,
  Menu, Settings, Ticket, Users, UsersRound, X, LogOut, UserCircle,
} from 'lucide-react'
import { ThemeToggle } from './theme-toggle'

export type NavItem = { href: string; label: string; icon: string; badge?: number }

const ICONS: Record<string, any> = {
  home: Home, my: CalendarCheck, calendar: CalendarDays, teams: UsersRound, events: ClipboardList, people: Users,
  registrations: Ticket, kids: Baby, tasks: CheckSquare, messages: Megaphone, rooms: Building2, reports: BarChart3,
  admin: Settings, bell: Bell, profile: UserCircle,
}

function isActive(path: string, href: string) {
  return href === '/' ? path === '/' : path === href || path.startsWith(href + '/')
}

export function AppNav({ items, mobile, user, unread }: { items: NavItem[]; mobile: NavItem[]; user: { name: string; role: string }; unread: number }) {
  const path = usePathname()
  const [open, setOpen] = useState(false)

  const link = (it: NavItem, onClick?: () => void) => {
    const Icon = ICONS[it.icon] ?? Home
    const active = isActive(path, it.href)
    return (
      <Link key={it.href} href={it.href} onClick={onClick}
        className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${active ? 'bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-200' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}`}>
        <Icon className="h-5 w-5 shrink-0" />
        <span className="flex-1">{it.label}</span>
        {!!it.badge && <span className="rounded-full bg-rose-500 px-1.5 text-xs font-bold text-white">{it.badge}</span>}
      </Link>
    )
  }

  return (
    <>
      {/* Компютър: странично меню */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950 lg:flex">
        <Link href="/" className="mb-6 flex items-center gap-2 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 font-black text-white">С</span>
          <span className="text-lg font-bold">Служение</span>
        </Link>
        <nav className="flex-1 space-y-1 overflow-y-auto">{items.map((i) => link(i))}</nav>
        <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div className="flex items-center gap-1">
            <Link href="/profile" className="min-w-0 flex-1 rounded-xl px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
              <div className="truncate text-sm font-semibold">{user.name}</div>
              <div className="muted truncate text-xs">{user.role}</div>
            </Link>
            <Link href="/notifications" className="btn-ghost relative p-2" aria-label="Известия">
              <Bell className="h-5 w-5" />
              {unread > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-rose-500" />}
            </Link>
            <ThemeToggle />
          </div>
          <form action="/auth/signout" method="post"><button className="btn-ghost mt-1 w-full justify-start"><LogOut className="h-4 w-4" />Изход</button></form>
        </div>
      </aside>

      {/* Телефон: горна лента */}
      <header className="no-print pt-safe sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 lg:hidden">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-black text-white">С</span>
          <span className="font-bold">Служение</span>
        </Link>
        <div className="flex items-center">
          <Link href="/notifications" className="btn-ghost relative p-2" aria-label="Известия">
            <Bell className="h-5 w-5" />
            {unread > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-rose-500" />}
          </Link>
          <ThemeToggle />
        </div>
      </header>

      {/* Телефон: долна навигация */}
      <nav className="no-print pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:hidden">
        <div className="grid grid-cols-5">
          {mobile.map((it) => {
            const Icon = ICONS[it.icon] ?? Home
            const active = isActive(path, it.href)
            return (
              <Link key={it.href} href={it.href} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active ? 'text-brand-600 dark:text-brand-200' : 'text-slate-500'}`}>
                <Icon className="h-6 w-6" />
                {it.label}
                {!!it.badge && <span className="absolute right-[22%] top-1 rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{it.badge}</span>}
              </Link>
            )
          })}
          <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-slate-500">
            <Menu className="h-6 w-6" />Още
          </button>
        </div>
      </nav>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="pb-safe absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-white p-4 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <Link href="/profile" onClick={() => setOpen(false)} className="min-w-0">
                <div className="truncate font-semibold">{user.name}</div>
                <div className="muted text-xs">{user.role} · Моят профил</div>
              </Link>
              <button className="btn-ghost p-2" onClick={() => setOpen(false)} aria-label="Затвори"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid grid-cols-1 gap-1">{items.map((i) => link(i, () => setOpen(false)))}</div>
            <form action="/auth/signout" method="post" className="mt-3"><button className="btn-secondary w-full"><LogOut className="h-4 w-4" />Изход</button></form>
          </div>
        </div>
      )}
    </>
  )
}

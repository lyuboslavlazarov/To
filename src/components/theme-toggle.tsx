'use client'
import { Moon, Sun } from 'lucide-react'

export function ThemeToggle({ className = '' }: { className?: string }) {
  return (
    <button
      type="button"
      aria-label="Светъл / тъмен режим"
      className={`btn-ghost p-2 ${className}`}
      onClick={() => {
        const dark = !document.documentElement.classList.contains('dark')
        document.documentElement.classList.toggle('dark', dark)
        try { localStorage.setItem('theme', dark ? 'dark' : 'light') } catch {}
      }}
    >
      <Sun className="hidden h-5 w-5 dark:block" />
      <Moon className="h-5 w-5 dark:hidden" />
    </button>
  )
}

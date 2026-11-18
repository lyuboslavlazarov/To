import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { AppNav, type NavItem } from '@/components/nav'
import { ROLE_LABEL } from '@/lib/format'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireMe()
  const supabase = await createClient()
  const [{ count: unread }, { count: pendingInvites }, pendingPeople] = await Promise.all([
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('profile_id', me.id).is('read_at', null),
    supabase.from('assignments').select('id, events!inner(starts_at)', { count: 'exact', head: true })
      .eq('profile_id', me.id).eq('status', 'pending').gte('events.starts_at', new Date().toISOString()),
    me.isAdmin ? supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending') : Promise.resolve({ count: 0 }),
  ])

  const items: NavItem[] = [
    { href: '/', label: 'Табло', icon: 'home' },
    { href: '/my', label: 'Моят календар', icon: 'my', badge: pendingInvites ?? 0 },
    { href: '/calendar', label: 'Общ календар', icon: 'calendar' },
    { href: '/teams', label: 'Моите екипи', icon: 'teams' },
  ]
  if (me.isStaff || me.isLeader || me.can('events')) items.push({ href: '/events', label: 'Събития и планове', icon: 'events' })
  if (me.isStaff || me.isLeader) items.push({ href: '/people', label: 'Хора', icon: 'people' })
  if (me.can('registrations')) items.push({ href: '/registrations', label: 'Регистрации', icon: 'registrations' })
  if (me.isKidsStaff) items.push({ href: '/kids', label: 'Детско служение', icon: 'kids' })
  items.push({ href: '/tasks', label: 'Задачи', icon: 'tasks' })
  items.push({ href: '/messages', label: 'Съобщения', icon: 'messages' })
  items.push({ href: '/rooms', label: 'Помещения', icon: 'rooms' })
  if (me.isStaff || me.isLeader) items.push({ href: '/reports', label: 'Отчети', icon: 'reports' })
  if (me.isAdmin) items.push({ href: '/admin', label: 'Администрация', icon: 'admin', badge: (pendingPeople as any).count ?? 0 })

  const mobile: NavItem[] = [
    { href: '/', label: 'Табло', icon: 'home' },
    { href: '/my', label: 'Моят', icon: 'my', badge: pendingInvites ?? 0 },
    { href: '/tasks', label: 'Задачи', icon: 'tasks' },
    { href: '/messages', label: 'Съобщения', icon: 'messages' },
  ]

  return (
    <div className="min-h-dvh lg:pl-64">
      <AppNav items={items} mobile={mobile} unread={unread ?? 0} user={{ name: fullName(me.profile), role: me.isLeader && me.role === 'member' ? 'Лидер на екип' : ROLE_LABEL[me.role] }} />
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-4 sm:px-6 lg:pb-10 lg:pt-8">{children}</main>
    </div>
  )
}

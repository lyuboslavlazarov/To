import { Tabs } from '@/components/ui'

export function TeamTabs({ id, active, canManage }: { id: string; active: string; canManage: boolean }) {
  const tabs = [
    { key: 'overview', href: `/teams/${id}`, label: 'Преглед' },
    { key: 'schedule', href: `/teams/${id}/schedule`, label: 'График' },
    { key: 'chat', href: `/teams/${id}/chat`, label: 'Чат' },
    { key: 'tasks', href: `/tasks?team=${id}`, label: 'Задачи' },
    { key: 'members', href: `/teams/${id}/members`, label: 'Членове' },
  ]
  if (canManage) tabs.splice(2, 0, { key: 'matrix', href: `/teams/${id}/matrix`, label: 'Матрица' }, { key: 'rotations', href: `/teams/${id}/rotations`, label: 'Ротации' })
  return <Tabs tabs={tabs} active={active} />
}

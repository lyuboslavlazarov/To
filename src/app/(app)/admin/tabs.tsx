import { Tabs } from '@/components/ui'

export function AdminTabs({ active }: { active: string }) {
  return (
    <Tabs active={active} tabs={[
      { key: 'approvals', href: '/admin', label: 'Одобрения' },
      { key: 'invite', href: '/admin/invite', label: 'Добави човек' },
      { key: 'structure', href: '/admin/structure', label: 'Структура' },
      { key: 'rooms', href: '/admin/rooms', label: 'Помещения' },
      { key: 'settings', href: '/admin/settings', label: 'Настройки' },
      { key: 'gdpr', href: '/admin/gdpr', label: 'GDPR заявки' },
      { key: 'audit', href: '/admin/audit', label: 'Одитен журнал' },
    ]} />
  )
}

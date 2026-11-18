import { Tabs } from '@/components/ui'
export function KidsTabs({ active }: { active: string }) {
  return <Tabs active={active} tabs={[
    { key: 'checkin', href: '/kids', label: 'Регистриране' },
    { key: 'children', href: '/kids/children', label: 'Деца' },
    { key: 'attendance', href: '/kids/attendance', label: 'Присъствие' },
  ]} />
}

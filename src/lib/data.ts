import 'server-only'

export type Dept = { id: string; slug: string | null; name: string; color: string; sort: number; description: string | null; teams: Team[] }
export type Team = {
  id: string; name: string; department_id: string; sort: number; description: string | null; allow_self_signup: boolean
  permissions: string[]; min_age: number | null; max_age: number | null; positions: Position[]
}
export type Position = { id: string; team_id: string; name: string; default_count: number; sort: number }

export async function getStructure(supabase: any): Promise<Dept[]> {
  const { data } = await supabase
    .from('departments')
    .select('*, teams(*, positions(*))')
    .order('sort')
  return ((data ?? []) as Dept[]).map((d) => ({
    ...d,
    teams: (d.teams ?? []).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)).map((t) => ({
      ...t,
      positions: (t.positions ?? []).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
    })),
  }))
}

export const PERMISSIONS: { key: string; label: string }[] = [
  { key: 'events', label: 'Създава събития' },
  { key: 'registrations', label: 'Регистрации и сканиране на вход' },
  { key: 'checkins', label: 'Регистриране на деца' },
  { key: 'rooms', label: 'Управлява резервациите' },
  { key: 'gifts', label: 'Подаръци и покупки' },
  { key: 'announcements', label: 'Съобщения до всички' },
]

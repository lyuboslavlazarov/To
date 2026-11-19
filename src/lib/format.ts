const TZ = 'Europe/Sofia'

export const fmtDate = (d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = {}) =>
  d ? new Intl.DateTimeFormat('bg-BG', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric', ...opts }).format(new Date(d)) : '—'

export const fmtShortDate = (d: string | Date) =>
  new Intl.DateTimeFormat('bg-BG', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(d))

export const fmtTime = (d: string | Date) =>
  new Intl.DateTimeFormat('bg-BG', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(d))

export const fmtDateTime = (d: string | Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('bg-BG', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d))
    : '—'

export const fmtWeekday = (d: string | Date) =>
  new Intl.DateTimeFormat('bg-BG', { timeZone: TZ, weekday: 'long' }).format(new Date(d))

/** „YYYY-MM-DDTHH:mm“ в часовата зона на София – за <input type="datetime-local"> */
export function toLocalInput(d: string | Date | null | undefined) {
  if (!d) return ''
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(d))
  return parts.replace(' ', 'T')
}

/** Обратното: стойност от datetime-local (време в София) → ISO UTC */
export function fromLocalInput(v: string | null | undefined): string | null {
  if (!v) return null
  const [date, time = '00:00'] = v.split('T')
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  const offset = tzOffsetMinutes(new Date(guess))
  return new Date(guess - offset * 60000).toISOString()
}

function tzOffsetMinutes(date: Date) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value)
  const asUTC = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'))
  return Math.round((asUTC - date.getTime()) / 60000)
}

/** Дата „YYYY-MM-DD“ в София */
export function localDay(d: string | Date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d))
}

export function ageFrom(birthdate?: string | null) {
  if (!birthdate) return null
  const b = new Date(birthdate)
  const n = new Date()
  let a = n.getFullYear() - b.getFullYear()
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--
  return a
}

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Чака', confirmed: 'Потвърдено', declined: 'Отказано',
  waitlist: 'Изчакване', cancelled: 'Отказана', open: 'Отворена', in_progress: 'В процес', done: 'Готово',
  active: 'Активен', inactive: 'Неактивен',
}
export const ROLE_LABEL: Record<string, string> = { admin: 'Администратор', leadership: 'Ръководство', member: 'Член' }

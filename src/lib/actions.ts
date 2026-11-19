import 'server-only'

export type Result = { error?: string; ok?: string }

export function dbError(e: { message?: string; code?: string } | null | undefined): string {
  const m = e?.message ?? 'Неизвестна грешка'
  if (/row-level security|permission denied/i.test(m)) return 'Нямате права за това действие'
  if (/duplicate key|unique/i.test(m)) return 'Такъв запис вече съществува'
  if (/violates foreign key/i.test(m)) return 'Записът се използва другаде и не може да бъде изтрит'
  if (/room_bookings_no_overlap|exclusion/i.test(m)) return 'Помещението е заето по това време'
  return m
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k)
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}
export const num = (fd: FormData, k: string) => {
  const v = str(fd, k)
  return v === null ? null : Number(v)
}
export const bool = (fd: FormData, k: string) => fd.get(k) === 'on' || fd.get(k) === 'true'

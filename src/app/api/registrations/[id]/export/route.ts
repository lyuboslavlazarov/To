import { NextResponse, type NextRequest } from 'next/server'
import ExcelJS from 'exceljs'
import { createClient } from '@/lib/supabase/server'

const ST: Record<string, string> = { confirmed: 'Потвърдена', waitlist: 'Изчакване', cancelled: 'Отказана' }
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' }) : '')

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const format = req.nextUrl.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx'
  const supabase = await createClient()
  const { data: e } = await supabase.from('reg_events').select('title, slug, questions, use_seating').eq('id', id).maybeSingle()
  const { data: regs, error } = await supabase.from('registrations').select('*').eq('reg_event_id', id).order('created_at')
  if (!e || error) return NextResponse.json({ error: 'Нямате достъп' }, { status: 403 })
  const qs = (e.questions ?? []) as any[]
  const header = ['Име', 'Фамилия', 'Имейл', 'Телефон', 'Статус', ...(e.use_seating ? ['Ред', 'Място'] : []), 'Регистриран', 'Влязъл', ...qs.map((q) => q.label)]
  const rows = (regs ?? []).map((r) => [r.first_name, r.last_name, r.email, r.phone ?? '', ST[r.status],
    ...(e.use_seating ? [r.seat_row ?? '', r.seat_number ?? ''] : []), fmt(r.created_at), fmt(r.checked_in_at), ...qs.map((q) => r.answers?.[q.id] ?? '')])
  const file = `registracii-${e.slug}`
  if (format === 'csv') {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
    return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file}.csv"` } })
  }
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Регистрации')
  ws.addRow(header).font = { bold: true }
  rows.forEach((r) => ws.addRow(r))
  ws.columns.forEach((c) => { c.width = 18 })
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  const buf = await wb.xlsx.writeBuffer()
  return new NextResponse(buf as ArrayBuffer, {
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${file}.xlsx"` },
  })
}

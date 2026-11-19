import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Avatar, Badge, Empty, Field, statusColor } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { ProfileForm } from '@/components/profile-form'
import { fmtDate, fmtDateTime, ROLE_LABEL, STATUS_LABEL, ageFrom } from '@/lib/format'
import { setRoleStatus } from '../../admin/actions'
import { addGift, deleteGift, addNote, deleteNote, toggleMemberPosition } from '../actions'

const CAT: Record<string, string> = { book: '📚 Книга', tshirt: '👕 Тениска', other: '🎁 Друго' }

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await requireMe()
  const supabase = await createClient()
  const { data: p } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
  if (!p) notFound()

  const [{ data: teams }, { data: mpos }, { data: history }, { data: gifts }, { data: notes }] = await Promise.all([
    supabase.from('team_members').select('team_id, is_leader, teams(id, name, departments(name, color), positions(id, name, sort))').eq('profile_id', id),
    supabase.from('member_positions').select('position_id').eq('profile_id', id),
    supabase.from('assignments').select('id, status, events(id, title, starts_at), positions(name), teams(name)').eq('profile_id', id).order('created_at', { ascending: false }).limit(50),
    me.can('gifts') || me.id === id ? supabase.from('gifts').select('*').eq('profile_id', id).order('given_on', { ascending: false }) : Promise.resolve({ data: null }),
    me.isLeadership || me.isAdmin ? supabase.from('profile_notes').select('*, author:profiles!profile_notes_author_id_fkey(first_name, last_name)').eq('profile_id', id).order('created_at', { ascending: false }) : Promise.resolve({ data: null }),
  ])
  const myPos = new Set((mpos ?? []).map((m) => m.position_id))
  const sortedHistory = (history ?? []).filter((h: any) => h.events).sort((a: any, b: any) => b.events.starts_at.localeCompare(a.events.starts_at))
  const served = sortedHistory.filter((h: any) => h.status === 'confirmed' && h.events.starts_at < new Date().toISOString())
  const age = ageFrom(p.birthday)

  return (
    <>
      <PageHeader back="/people" title={
        <span className="flex items-center gap-3"><Avatar p={p} size={48} />{fullName(p)}</span>
      } subtitle={<>{ROLE_LABEL[p.system_role]} · {STATUS_LABEL[p.status]}</>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Данни">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div><dt className="muted text-xs">Имейл</dt><dd className="break-all"><a href={`mailto:${p.email}`}>{p.email}</a></dd></div>
              <div><dt className="muted text-xs">Телефон</dt><dd>{p.phone ? <a href={`tel:${p.phone}`}>{p.phone}</a> : '—'}</dd></div>
              <div><dt className="muted text-xs">Рожден ден</dt><dd>{p.birthday ? `${fmtDate(p.birthday, { year: undefined })}${age != null ? ` (${age} г.)` : ''}` : '—'}</dd></div>
              <div><dt className="muted text-xs">Тениска</dt><dd>{p.tshirt_size ?? '—'}</dd></div>
              <div className="col-span-2"><dt className="muted text-xs">Умения</dt><dd className="flex flex-wrap gap-1">{(p.skills ?? []).length ? p.skills.map((s: string) => <Badge key={s}>{s}</Badge>) : '—'}</dd></div>
            </dl>
            {me.isAdmin && (
              <details className="mt-4"><summary className="cursor-pointer text-sm text-brand-600">Редактирай</summary><div className="mt-3"><ProfileForm p={p} /></div></details>
            )}
          </Card>

          <Card title="Служения и позиции">
            {!teams?.length ? <Empty>Не е в нито едно служение.</Empty> : (
              <div className="space-y-3">
                {teams.map((t: any) => {
                  const canEdit = me.isAdmin || me.ledTeamIds.includes(t.team_id) || me.isStaff
                  return (
                    <div key={t.team_id}>
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.teams.departments?.color }} />
                        <Link href={`/teams/${t.team_id}`} className="font-medium hover:underline">{t.teams.name}</Link>
                        <span className="muted text-xs">{t.teams.departments?.name}</span>
                        {t.is_leader && <Badge color="blue">Лидер</Badge>}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5 pl-4">
                        {(t.teams.positions ?? []).sort((a: any, b: any) => a.sort - b.sort).map((pos: any) => {
                          const on = myPos.has(pos.id)
                          return canEdit ? (
                            <ActionForm key={pos.id} action={toggleMemberPosition} className="inline">
                              <input type="hidden" name="profile_id" value={id} />
                              <input type="hidden" name="position_id" value={pos.id} />
                              <input type="hidden" name="on" value={on ? 'false' : 'true'} />
                              <SubmitButton className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-200' : 'border-slate-300 text-slate-500 dark:border-slate-700'}`}>
                                {on ? '✓ ' : '+ '}{pos.name}
                              </SubmitButton>
                            </ActionForm>
                          ) : on ? <Badge key={pos.id} color="blue">{pos.name}</Badge> : null
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          <Card title={`История на служенето (${served.length} пъти)`}>
            {!sortedHistory.length ? <Empty>Няма записи.</Empty> : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {sortedHistory.slice(0, 30).map((h: any) => (
                  <li key={h.id} className="flex items-center gap-2 py-2">
                    <span className="muted w-28 shrink-0 text-xs">{fmtDateTime(h.events.starts_at)}</span>
                    <Link href={`/events/${h.events.id}`} className="min-w-0 flex-1 truncate hover:underline">{h.events.title}</Link>
                    <span className="muted hidden text-xs sm:inline">{h.teams?.name} · {h.positions?.name}</span>
                    <Badge color={statusColor(h.status)}>{STATUS_LABEL[h.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {me.isAdmin && (
            <Card title="Роля и статус">
              <ActionForm action={setRoleStatus} className="space-y-3">
                <input type="hidden" name="id" value={id} />
                <Field label="Роля">
                  <select name="role" defaultValue={p.system_role} className="input">
                    <option value="member">Член / доброволец</option><option value="leadership">Ръководство</option><option value="admin">Администратор</option>
                  </select>
                </Field>
                <Field label="Статус">
                  <select name="status" defaultValue={p.status} className="input">
                    <option value="active">Активен</option><option value="pending">Чака одобрение</option><option value="inactive">Неактивен</option>
                  </select>
                </Field>
                <SubmitButton>Запази</SubmitButton>
              </ActionForm>
              <p className="muted mt-2 text-xs">Лидерите на екипи се определят от страницата „Членове“ на екипа.</p>
            </Card>
          )}

          {gifts && (
            <Card title="Подаръци и покупки">
              {me.can('gifts') && (
                <ActionForm action={addGift} className="mb-4 space-y-2" resetOnOk>
                  <input type="hidden" name="profile_id" value={id} />
                  <input name="item_name" placeholder="Напр. „Целенасочен живот“ или „Тениска – екип“" className="input" required />
                  <div className="grid grid-cols-3 gap-2">
                    <select name="category" className="input"><option value="book">Книга</option><option value="tshirt">Тениска</option><option value="other">Друго</option></select>
                    <select name="kind" className="input"><option value="gift">Подарък</option><option value="purchase">Покупка</option></select>
                    <input name="given_on" type="date" className="input" defaultValue={new Date().toISOString().slice(0, 10)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input name="price" type="number" step="0.01" placeholder="Цена (по избор)" className="input" />
                    <input name="notes" placeholder="Бележка" className="input" />
                  </div>
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="force" />Добави въпреки това (ако вече има същото)</label>
                  <SubmitButton className="btn-primary btn-sm">Добави</SubmitButton>
                </ActionForm>
              )}
              {!gifts.length ? <p className="muted text-sm">Няма записи.</p> : (
                <ul className="space-y-2 text-sm">
                  {gifts.map((g: any) => (
                    <li key={g.id} className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{g.item_name}</div>
                        <div className="muted text-xs">{CAT[g.category]} · {g.kind === 'gift' ? 'подарък' : 'покупка'} · {fmtDate(g.given_on)}{g.price ? ` · ${g.price} лв.` : ''}</div>
                      </div>
                      {me.can('gifts') && (
                        <ActionForm action={deleteGift}><input type="hidden" name="id" value={g.id} /><input type="hidden" name="profile_id" value={id} />
                          <SubmitButton className="btn-ghost btn-sm" confirm="Изтриване?">✕</SubmitButton></ActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {notes && (
            <Card title="🔒 Бележки">
              <p className="muted mb-2 text-xs">Обикновените бележки виждат ръководството и администраторът. Личните бележки от срещи – само ръководството.</p>
              <ActionForm action={addNote} className="mb-3 space-y-2" resetOnOk>
                <input type="hidden" name="profile_id" value={id} />
                <textarea name="body" rows={3} className="input" placeholder="Бележка…" required />
                {me.isLeadership && (
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_private" />🤝 Лична бележка от среща (само за ръководството)</label>
                )}
                <SubmitButton className="btn-primary btn-sm">Добави бележка</SubmitButton>
              </ActionForm>
              <ul className="space-y-3 text-sm">
                {notes.map((n: any) => (
                  <li key={n.id} className={`rounded-xl p-3 ${n.is_private ? 'bg-violet-50 dark:bg-violet-900/20' : 'bg-amber-50 dark:bg-amber-900/20'}`}>
                    {n.is_private && <div className="mb-1"><Badge color="blue">🤝 Лична – само ръководството</Badge></div>}
                    <p className="whitespace-pre-line">{n.body}</p>
                    <div className="muted mt-1 flex items-center justify-between text-xs">
                      <span>{fullName(n.author)} · {fmtDateTime(n.created_at)}</span>
                      <ActionForm action={deleteNote}><input type="hidden" name="id" value={n.id} /><input type="hidden" name="profile_id" value={id} />
                        <SubmitButton className="btn-ghost btn-sm" confirm="Изтриване на бележката?">Изтрий</SubmitButton></ActionForm>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

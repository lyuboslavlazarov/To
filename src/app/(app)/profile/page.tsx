import Link from 'next/link'
import { requireMe, fullName } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Avatar, Badge } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/forms'
import { ProfileForm } from '@/components/profile-form'
import { AvatarUpload } from '@/components/avatar-upload'
import { PushToggle } from '@/components/push-toggle'
import { InstallHelp } from '@/components/install-help'
import { ROLE_LABEL } from '@/lib/format'
import { requestDeletion } from './actions'

export const metadata = { title: 'Моят профил' }

export default async function ProfilePage() {
  const me = await requireMe()
  const supabase = await createClient()
  const { data: factors } = await supabase.auth.mfa.listFactors()
  const hasMfa = !!factors?.totp?.some((f) => f.status === 'verified')
  return (
    <>
      <PageHeader title="Моят профил" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <div className="mb-4 flex items-center gap-4">
              <Avatar p={me.profile} size={64} />
              <div>
                <div className="text-lg font-semibold">{fullName(me.profile)}</div>
                <div className="muted text-sm">{me.email} · {ROLE_LABEL[me.role]}</div>
                <div className="mt-2"><AvatarUpload userId={me.id} /></div>
              </div>
            </div>
            <ProfileForm p={me.profile} />
          </Card>
          <Card title="Моите служения">
            <div className="flex flex-wrap gap-2">
              {me.memberships.length ? me.memberships.map((m) => (
                <Link key={m.team_id} href={`/teams/${m.team_id}`}><Badge color={m.is_leader ? 'blue' : 'gray'}>{m.team.name}{m.is_leader ? ' · лидер' : ''}</Badge></Link>
              )) : <span className="muted text-sm">Още не сте добавени в служение.</span>}
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Известия"><PushToggle /></Card>
          <Card title="Инсталиране на телефона"><InstallHelp /></Card>
          <Card title="Сигурност">
            <p className="text-sm">Двуфакторна защита: {hasMfa ? <Badge color="green">включена</Badge> : <Badge>не е включена</Badge>}</p>
            {!hasMfa && <Link href="/mfa" className="btn-secondary btn-sm mt-2">Включи 2FA</Link>}
          </Card>
          <Card title="Моите данни (GDPR)">
            <p className="muted mb-3 text-sm">Имате право на копие от данните си и право да поискате изтриването им.</p>
            <a href="/api/me/export" className="btn-secondary btn-sm">⬇ Изтегли моите данни</a>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-rose-600">Поискай изтриване на профила</summary>
              <ActionForm action={requestDeletion} className="mt-2 space-y-2">
                <textarea name="note" rows={2} className="input" placeholder="Причина (по избор)" />
                <SubmitButton className="btn-danger btn-sm" confirm="Да изпратя ли заявка за изтриване?">Изпрати заявка</SubmitButton>
              </ActionForm>
            </details>
            <Link href="/privacy" className="mt-3 block text-xs text-brand-600 underline">Политика за поверителност</Link>
          </Card>
        </div>
      </div>
    </>
  )
}

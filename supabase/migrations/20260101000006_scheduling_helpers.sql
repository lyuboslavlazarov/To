-- =====================================================================
-- 0006 ПОМОЩНИ ФУНКЦИИ ЗА ГРАФИЦИТЕ (за лидерите)
-- =====================================================================

-- Всички членове на екипа с информация за дадено събитие:
-- свободен ли е, „Не мога“, отсъствие, къде е зает по това време, кога е служил последно.
create or replace function public.event_team_candidates(p_event uuid, p_team uuid)
returns table (
  profile_id uuid, first_name text, last_name text, avatar_url text, position_ids uuid[],
  available boolean, cannot boolean, blocked boolean, busy text, last_served timestamptz, times_90d bigint
)
language sql stable security definer set search_path = '' as $$
  with ev as (select starts_at, ends_at from public.events where id = p_event)
  select p.id, p.first_name, p.last_name, p.avatar_url,
    coalesce((select array_agg(mp.position_id) from public.member_positions mp
              join public.positions po on po.id = mp.position_id
              where mp.profile_id = p.id and po.team_id = p_team), '{}'),
    exists (select 1 from public.availability v where v.profile_id = p.id and v.event_id = p_event and v.team_id = p_team),
    exists (select 1 from public.availability v where v.profile_id = p.id and v.event_id = p_event and v.team_id is null),
    exists (select 1 from public.blockouts b where b.profile_id = p.id
            and daterange(b.starts_on, b.ends_on, '[]') @> (ev.starts_at at time zone 'Europe/Sofia')::date),
    (select string_agg(t.name || ' – ' || po.name || case when e.id <> p_event then ' („' || e.title || '“)' else '' end, '; ')
       from public.assignments a
       join public.events e on e.id = a.event_id
       join public.teams t on t.id = a.team_id
       join public.positions po on po.id = a.position_id
      where a.profile_id = p.id and a.status <> 'declined' and not e.is_cancelled
        and tstzrange(e.starts_at, e.ends_at) && tstzrange(ev.starts_at, ev.ends_at)),
    (select max(e.starts_at) from public.assignments a join public.events e on e.id = a.event_id
      where a.profile_id = p.id and a.team_id = p_team and a.status <> 'declined' and e.starts_at < now()),
    (select count(*) from public.assignments a join public.events e on e.id = a.event_id
      where a.profile_id = p.id and a.team_id = p_team and a.status <> 'declined'
        and e.starts_at > now() - interval '90 days' and e.starts_at < now())
  from public.team_members tm
  join public.profiles p on p.id = tm.profile_id and p.status = 'active', ev
  where tm.team_id = p_team and public.can_manage_team(p_team)
  order by p.first_name, p.last_name;
$$;

-- Отворени места в екипите ми (за самостоятелно записване)
create or replace function public.open_slots_for_me(p_from timestamptz default now(), p_to timestamptz default now() + interval '60 days')
returns table (event_id uuid, title text, starts_at timestamptz, team_id uuid, team_name text, position_id uuid, position_name text, open_slots bigint)
language sql stable security definer set search_path = '' as $$
  select e.id, e.title, e.starts_at, t.id, t.name, po.id, po.name,
         n.needed - (select count(*) from public.assignments a where a.event_id = e.id and a.position_id = po.id and a.status <> 'declined')
  from public.plan_needs n
  join public.events e on e.id = n.event_id and not e.is_cancelled
  join public.teams t on t.id = n.team_id and t.allow_self_signup
  join public.positions po on po.id = n.position_id
  where e.starts_at between p_from and p_to
    and public.is_team_member(t.id)
    and (not exists (select 1 from public.member_positions mp join public.positions px on px.id = mp.position_id
                     where mp.profile_id = auth.uid() and px.team_id = t.id)
         or exists (select 1 from public.member_positions mp where mp.profile_id = auth.uid() and mp.position_id = po.id))
    and n.needed > (select count(*) from public.assignments a where a.event_id = e.id and a.position_id = po.id and a.status <> 'declined')
  order by e.starts_at;
$$;

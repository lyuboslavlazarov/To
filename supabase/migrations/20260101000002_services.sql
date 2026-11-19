-- =====================================================================
-- 0002 СЛУЖЕНИЯ И ГРАФИЦИ, КАЛЕНДАР И ПОМЕЩЕНИЯ
-- =====================================================================

create type public.event_visibility  as enum ('all', 'teams', 'leadership');
create type public.assignment_status as enum ('pending', 'confirmed', 'declined');

-- ---------------------------------------------------------------------
-- Помещения
-- ---------------------------------------------------------------------
create table public.rooms (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  capacity      int,
  seat_rows     int,          -- схема на залата по подразбиране
  seats_per_row int,
  is_bookable   boolean not null default true,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Повтарящи се събития (серии) и събития (планове)
-- ---------------------------------------------------------------------
create table public.event_series (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text,
  weekday          smallint not null check (weekday between 1 and 7),  -- 1 = понеделник … 7 = неделя
  start_time       time not null,
  duration_minutes int not null default 120 check (duration_minutes > 0),
  interval_weeks   int not null default 1 check (interval_weeks between 1 and 8),
  room_id          uuid references public.rooms (id) on delete set null,
  starts_on        date not null default current_date,
  ends_on          date,
  visibility       public.event_visibility not null default 'all',
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);

create table public.series_needs (
  series_id   uuid not null references public.event_series (id) on delete cascade,
  position_id uuid not null references public.positions (id) on delete cascade,
  needed      int not null default 1 check (needed > 0),
  primary key (series_id, position_id)
);

create table public.events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  room_id      uuid references public.rooms (id) on delete set null,
  series_id    uuid references public.event_series (id) on delete set null,
  visibility   public.event_visibility not null default 'all',
  color        text,
  is_cancelled boolean not null default false,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index events_starts_idx on public.events (starts_at);
create index events_range_idx on public.events using gist (tstzrange(starts_at, ends_at));
create unique index events_series_start_uq on public.events (series_id, starts_at) where series_id is not null;
create trigger events_touch before update on public.events for each row execute function public.touch_updated_at();

-- Програма на събитието (team_id = null → обща за всички)
create table public.plan_items (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events (id) on delete cascade,
  team_id          uuid references public.teams (id) on delete cascade,
  sort             int not null default 0,
  title            text not null,
  duration_minutes int,
  notes            text,
  created_at       timestamptz not null default now()
);
create index on public.plan_items (event_id);

-- Нужни хора по позиции
create table public.plan_needs (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  position_id uuid not null references public.positions (id) on delete cascade,
  team_id     uuid not null references public.teams (id) on delete cascade,
  needed      int not null default 1 check (needed >= 0),
  unique (event_id, position_id)
);
create index on public.plan_needs (team_id);

create table public.plan_notes (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  team_id    uuid references public.teams (id) on delete cascade,
  body       text not null,
  author_id  uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.plan_notes (event_id);

create table public.plan_files (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  team_id      uuid references public.teams (id) on delete cascade,
  name         text not null,
  storage_path text not null,
  uploaded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index on public.plan_files (event_id);

-- Свободен ли е човекът: ред с team_id = свободен за това служение;
-- ред с team_id = null и status = 'unavailable' = „Не мога“ за цялото събитие
create table public.availability (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  team_id    uuid references public.teams (id) on delete cascade,
  status     text not null default 'available' check (status in ('available','unavailable')),
  note       text,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (profile_id, event_id, team_id),
  check ((team_id is null and status = 'unavailable') or (team_id is not null and status = 'available'))
);
create index on public.availability (event_id, team_id);

-- Дати на отсъствие
create table public.blockouts (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  starts_on  date not null,
  ends_on    date not null,
  reason     text,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index on public.blockouts (profile_id, starts_on);

-- Разпределение (покана)
create table public.assignments (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events (id) on delete cascade,
  position_id    uuid not null references public.positions (id) on delete cascade,
  team_id        uuid not null references public.teams (id) on delete cascade,
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  status         public.assignment_status not null default 'pending',
  decline_reason text,
  assigned_by    uuid references public.profiles (id) on delete set null,
  responded_at   timestamptz,
  reminded_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (event_id, position_id, profile_id)
);
create index on public.assignments (profile_id, status);
create index on public.assignments (event_id, team_id);

-- Шаблони за ротации: slots = [{ "week": 0, "position_id": "...", "profile_id": "..." }, ...]
create table public.rotation_templates (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  name       text not null,
  weeks      int not null default 4 check (weeks between 1 and 12),
  slots      jsonb not null default '[]',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Резервации на помещения – без застъпване (exclusion constraint)
create table public.room_bookings (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms (id) on delete cascade,
  event_id   uuid unique references public.events (id) on delete cascade,
  team_id    uuid references public.teams (id) on delete set null,
  title      text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  notes      text,
  booked_by  uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  constraint room_bookings_no_overlap exclude using gist
    (room_id with =, tstzrange(starts_at, ends_at) with &&)
);

-- =====================================================================
-- ФУНКЦИИ И ТРИГЕРИ
-- =====================================================================

-- Видимо ли е събитието за мен
create or replace function public.can_see_event(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff()
      or exists (select 1 from public.events e where e.id = p_event and public.is_active_user() and (
             e.visibility = 'all'
          or (e.visibility = 'teams' and (
                 exists (select 1 from public.plan_needs n where n.event_id = e.id and n.team_id in (select public.my_team_ids()))
              or exists (select 1 from public.assignments a where a.event_id = e.id and a.profile_id = auth.uid())))));
$$;

-- team_id се попълва автоматично от позицията
create or replace function public.set_team_from_position() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select team_id into new.team_id from public.positions where id = new.position_id;
  return new;
end $$;

create trigger plan_needs_team before insert or update of position_id on public.plan_needs
  for each row execute function public.set_team_from_position();
create trigger assignments_team before insert or update of position_id on public.assignments
  for each row execute function public.set_team_from_position();

-- ЗАЩИТА ОТ КОНФЛИКТИ: един човек не може да е на две места по едно и също време
create or replace function public.check_assignment_conflict() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ev record; c record; who text;
begin
  if new.status = 'declined' then return new; end if;
  -- сериализираме записите за този човек, за да няма „състезание“ между двама лидери
  perform pg_advisory_xact_lock(hashtextextended(new.profile_id::text, 0));

  select starts_at, ends_at, (starts_at at time zone 'Europe/Sofia')::date as d1,
         (ends_at at time zone 'Europe/Sofia')::date as d2
    into ev from public.events where id = new.event_id;
  select trim(first_name || ' ' || last_name) into who from public.profiles where id = new.profile_id;

  select e.title, e.starts_at, t.name as team_name, p.name as position_name into c
  from public.assignments a
  join public.events e on e.id = a.event_id
  join public.teams t on t.id = a.team_id
  join public.positions p on p.id = a.position_id
  where a.profile_id = new.profile_id and a.id <> new.id and a.status <> 'declined'
    and not e.is_cancelled
    and tstzrange(e.starts_at, e.ends_at) && tstzrange(ev.starts_at, ev.ends_at)
  limit 1;
  if found then
    raise exception 'КОНФЛИКТ: % вече е записан(а) като „%“ (%) на „%“ по същото време',
      who, c.position_name, c.team_name, c.title using errcode = 'P0001';
  end if;

  if exists (select 1 from public.blockouts b where b.profile_id = new.profile_id
             and daterange(b.starts_on, b.ends_on, '[]') && daterange(ev.d1, ev.d2, '[]')) then
    raise exception 'КОНФЛИКТ: % е отбелязал(а) отсъствие за тази дата', who using errcode = 'P0001';
  end if;

  if exists (select 1 from public.availability v where v.profile_id = new.profile_id
             and v.event_id = new.event_id and v.team_id is null and v.status = 'unavailable')
     and new.profile_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) then
    raise exception 'КОНФЛИКТ: % е отбелязал(а) „Не мога“ за това събитие', who using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger assignments_conflict before insert or update of status, profile_id, event_id on public.assignments
  for each row execute function public.check_assignment_conflict();

-- Ако се промени часът на събитие – проверка дали не се получава двойно записване
create or replace function public.check_event_time_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  if new.starts_at = old.starts_at and new.ends_at = old.ends_at then return new; end if;
  select trim(p.first_name || ' ' || p.last_name) as who, e2.title into c
  from public.assignments a
  join public.assignments a2 on a2.profile_id = a.profile_id and a2.event_id <> a.event_id and a2.status <> 'declined'
  join public.events e2 on e2.id = a2.event_id and not e2.is_cancelled
  join public.profiles p on p.id = a.profile_id
  where a.event_id = new.id and a.status <> 'declined'
    and tstzrange(e2.starts_at, e2.ends_at) && tstzrange(new.starts_at, new.ends_at)
  limit 1;
  if found then
    raise exception 'КОНФЛИКТ: при този час % ще е записан(а) и на „%“', c.who, c.title using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger events_time_change before update of starts_at, ends_at on public.events
  for each row execute function public.check_event_time_change();

-- Доброволецът може да промени само отговора си (приема / отказва)
create or replace function public.assignments_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.can_manage_team(old.team_id) then return new; end if;
  if old.profile_id <> auth.uid() then raise exception 'Нямате права'; end if;
  if new.event_id <> old.event_id or new.position_id <> old.position_id or new.profile_id <> old.profile_id
     or new.assigned_by is distinct from old.assigned_by then
    raise exception 'Можете само да приемете или откажете';
  end if;
  new.responded_at := now();
  return new;
end $$;

create trigger assignments_guard before update on public.assignments
  for each row execute function public.assignments_guard();

-- Къде е зает човекът (за лидера): събития, които се застъпват с даденото
create or replace function public.person_busy(p_profile uuid, p_event uuid)
returns table (event_id uuid, title text, starts_at timestamptz, team_name text, position_name text, status public.assignment_status, reason text)
language sql stable security definer set search_path = '' as $$
  with ev as (select starts_at, ends_at from public.events where id = p_event)
  select e.id, e.title, e.starts_at, t.name, p.name, a.status, 'assignment'
  from public.assignments a
  join public.events e on e.id = a.event_id
  join public.teams t on t.id = a.team_id
  join public.positions p on p.id = a.position_id, ev
  where (public.is_staff() or public.leads_person(p_profile) or p_profile = auth.uid())
    and a.profile_id = p_profile and a.status <> 'declined' and not e.is_cancelled
    and tstzrange(e.starts_at, e.ends_at) && tstzrange(ev.starts_at, ev.ends_at)
  union all
  select null, coalesce(b.reason, 'Отсъствие'), null, null, null, null, 'blockout'
  from public.blockouts b, ev
  where (public.is_staff() or public.leads_person(p_profile) or p_profile = auth.uid())
    and b.profile_id = p_profile
    and daterange(b.starts_on, b.ends_on, '[]') @> (ev.starts_at at time zone 'Europe/Sofia')::date
  union all
  select null, 'Не мога', null, null, null, null, 'unavailable'
  from public.availability v
  where (public.is_staff() or public.leads_person(p_profile) or p_profile = auth.uid())
    and v.profile_id = p_profile and v.event_id = p_event and v.team_id is null;
$$;

-- Кога последно е служил човекът в даден екип (за автоматичното попълване)
create or replace function public.last_served(p_team uuid)
returns table (profile_id uuid, last_at timestamptz, times_90d bigint)
language sql stable security definer set search_path = '' as $$
  select tm.profile_id,
         max(e.starts_at) filter (where e.starts_at < now()),
         count(*) filter (where e.starts_at > now() - interval '90 days' and e.starts_at < now())
  from public.team_members tm
  left join public.assignments a on a.profile_id = tm.profile_id and a.team_id = p_team and a.status <> 'declined'
  left join public.events e on e.id = a.event_id
  where tm.team_id = p_team and public.can_manage_team(p_team)
  group by tm.profile_id;
$$;

-- Генериране на събитията от серия (до дата)
create or replace function public.generate_series_events(p_series uuid, p_until date)
returns int language plpgsql security invoker set search_path = '' as $$
declare
  s record; d date; n int := 0; st timestamptz; new_id uuid; first_d date;
begin
  select * into s from public.event_series where id = p_series;
  if not found then raise exception 'Серията не е намерена'; end if;
  first_d := s.starts_on + ((s.weekday - extract(isodow from s.starts_on)::int + 7) % 7);
  d := first_d;
  while d <= least(p_until, coalesce(s.ends_on, p_until)) loop
    st := (d + s.start_time) at time zone 'Europe/Sofia';
    if st > now() then
      insert into public.events (title, description, starts_at, ends_at, room_id, series_id, visibility, created_by)
      values (s.title, s.description, st, st + make_interval(mins => s.duration_minutes), s.room_id, s.id, s.visibility, auth.uid())
      on conflict (series_id, starts_at) where series_id is not null do nothing
      returning id into new_id;
      if new_id is not null then
        insert into public.plan_needs (event_id, position_id, team_id, needed)
        select new_id, sn.position_id, p.team_id, sn.needed
        from public.series_needs sn join public.positions p on p.id = sn.position_id
        where sn.series_id = s.id;
        n := n + 1;
        new_id := null;
      end if;
    end if;
    d := d + 7 * s.interval_weeks;
  end loop;
  return n;
end $$;

-- Събитие в зала → автоматична резервация (без застъпване)
create or replace function public.sync_event_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.room_id is null or new.is_cancelled then
    delete from public.room_bookings where event_id = new.id;
    return new;
  end if;
  begin
    insert into public.room_bookings (room_id, event_id, title, starts_at, ends_at, booked_by)
    values (new.room_id, new.id, new.title, new.starts_at, new.ends_at, auth.uid())
    on conflict (event_id) do update
      set room_id = excluded.room_id, title = excluded.title,
          starts_at = excluded.starts_at, ends_at = excluded.ends_at;
  exception when exclusion_violation then
    raise exception 'Помещението е заето по това време' using errcode = 'P0001';
  end;
  return new;
end $$;

create trigger events_booking after insert or update of room_id, starts_at, ends_at, title, is_cancelled on public.events
  for each row execute function public.sync_event_booking();

create or replace function public.room_booking_friendly_error() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from public.room_bookings b where b.room_id = new.room_id and b.id <> new.id
             and tstzrange(b.starts_at, b.ends_at) && tstzrange(new.starts_at, new.ends_at)) then
    raise exception 'Помещението е заето по това време' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger room_bookings_check before insert or update on public.room_bookings
  for each row execute function public.room_booking_friendly_error();

select public.enable_audit(t) from unnest(array[
  'public.rooms','public.event_series','public.series_needs','public.events','public.plan_items',
  'public.plan_needs','public.plan_notes','public.plan_files','public.assignments','public.blockouts',
  'public.rotation_templates','public.room_bookings'
]::regclass[]) t;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.rooms              enable row level security;
alter table public.event_series       enable row level security;
alter table public.series_needs       enable row level security;
alter table public.events             enable row level security;
alter table public.plan_items         enable row level security;
alter table public.plan_needs         enable row level security;
alter table public.plan_notes         enable row level security;
alter table public.plan_files         enable row level security;
alter table public.availability       enable row level security;
alter table public.blockouts          enable row level security;
alter table public.assignments        enable row level security;
alter table public.rotation_templates enable row level security;
alter table public.room_bookings      enable row level security;

create policy rooms_read  on public.rooms for select to authenticated using (public.is_active_user());
create policy rooms_write on public.rooms for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy series_read  on public.event_series for select to authenticated using (public.is_active_user());
create policy series_write on public.event_series for all to authenticated
  using (public.has_permission('events')) with check (public.has_permission('events'));
create policy series_needs_read on public.series_needs for select to authenticated using (public.is_active_user());
create policy series_needs_write on public.series_needs for all to authenticated
  using (public.has_permission('events') or exists (select 1 from public.positions p where p.id = position_id and public.is_team_leader(p.team_id)))
  with check (public.has_permission('events') or exists (select 1 from public.positions p where p.id = position_id and public.is_team_leader(p.team_id)));

-- Общ календар: всички активни виждат събитията с видимост „всички“
create policy events_read on public.events for select to authenticated using (public.can_see_event(id));
create policy events_write on public.events for all to authenticated
  using (public.has_permission('events')) with check (public.has_permission('events'));

-- Програма: общите точки – за всички, които виждат събитието; точките на екип – само за екипа
create policy plan_items_read on public.plan_items for select to authenticated
  using (public.can_see_event(event_id) and (team_id is null or public.is_staff() or public.is_team_member(team_id) or public.is_team_leader(team_id)));
create policy plan_items_write on public.plan_items for all to authenticated
  using ((team_id is null and public.has_permission('events')) or (team_id is not null and public.can_manage_team(team_id)))
  with check ((team_id is null and public.has_permission('events')) or (team_id is not null and public.can_manage_team(team_id)));

create policy plan_needs_read on public.plan_needs for select to authenticated
  using (public.is_staff() or public.is_team_member(team_id) or public.is_team_leader(team_id));
create policy plan_needs_write on public.plan_needs for all to authenticated
  using (public.can_manage_team(team_id) or public.has_permission('events'))
  with check (public.can_manage_team(team_id) or public.has_permission('events'));

create policy plan_notes_read on public.plan_notes for select to authenticated
  using (public.can_see_event(event_id) and (team_id is null or public.is_staff() or public.is_team_member(team_id) or public.is_team_leader(team_id)));
create policy plan_notes_write on public.plan_notes for all to authenticated
  using ((team_id is null and public.has_permission('events')) or (team_id is not null and public.can_manage_team(team_id)))
  with check ((team_id is null and public.has_permission('events')) or (team_id is not null and public.can_manage_team(team_id)));

create policy plan_files_read on public.plan_files for select to authenticated
  using (public.can_see_event(event_id) and (team_id is null or public.is_staff() or public.is_team_member(team_id) or public.is_team_leader(team_id)));
create policy plan_files_write on public.plan_files for all to authenticated
  using ((team_id is null and public.has_permission('events')) or (team_id is not null and public.can_manage_team(team_id)))
  with check ((team_id is null and public.has_permission('events')) or (team_id is not null and public.can_manage_team(team_id)));

-- Свободни дати: всеки отбелязва за себе си; лидерът вижда за своя екип
create policy availability_read on public.availability for select to authenticated
  using (profile_id = auth.uid() or public.is_staff()
         or (team_id is not null and public.is_team_leader(team_id))
         or (team_id is null and public.leads_person(profile_id)));
create policy availability_write on public.availability for all to authenticated
  using (profile_id = auth.uid() and public.is_active_user())
  with check (profile_id = auth.uid() and public.is_active_user() and (team_id is null or public.is_team_member(team_id)));

create policy blockouts_read on public.blockouts for select to authenticated
  using (profile_id = auth.uid() or public.is_staff() or public.leads_person(profile_id));
create policy blockouts_write on public.blockouts for all to authenticated
  using (profile_id = auth.uid() or public.is_admin())
  with check ((profile_id = auth.uid() and public.is_active_user()) or public.is_admin());

-- Графици: всеки вижда своите; членовете на екипа – графика на екипа; лидерът го управлява
create policy assignments_read on public.assignments for select to authenticated
  using (profile_id = auth.uid() or public.is_staff() or public.is_team_member(team_id) or public.is_team_leader(team_id));
create policy assignments_insert on public.assignments for insert to authenticated
  with check (public.can_manage_team(team_id)
              or (profile_id = auth.uid() and public.is_team_member(team_id)
                  and exists (select 1 from public.teams t where t.id = team_id and t.allow_self_signup)));
create policy assignments_update on public.assignments for update to authenticated
  using (public.can_manage_team(team_id) or profile_id = auth.uid())
  with check (public.can_manage_team(team_id) or profile_id = auth.uid());
create policy assignments_delete on public.assignments for delete to authenticated
  using (public.can_manage_team(team_id) or (profile_id = auth.uid() and status = 'pending'
         and exists (select 1 from public.teams t where t.id = team_id and t.allow_self_signup)));

create policy rotations_all on public.rotation_templates for all to authenticated
  using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id));

-- Резервации: всички активни виждат заетостта; резервират лидери, ръководство и екипи с право „rooms“
create policy bookings_read on public.room_bookings for select to authenticated using (public.is_active_user());
create policy bookings_insert on public.room_bookings for insert to authenticated
  with check (event_id is null and (public.has_permission('rooms') or public.is_any_leader()) and booked_by = auth.uid());
create policy bookings_update on public.room_bookings for update to authenticated
  using (event_id is null and (booked_by = auth.uid() or public.has_permission('rooms')))
  with check (event_id is null and (booked_by = auth.uid() or public.has_permission('rooms')));
create policy bookings_delete on public.room_bookings for delete to authenticated
  using (event_id is null and (booked_by = auth.uid() or public.has_permission('rooms')));

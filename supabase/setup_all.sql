-- ВСИЧКО В ЕДИН ФАЙЛ: схема, права (RLS), функции и начална структура.
-- Генерирано от scripts/build-setup-sql.sh – не редактирайте ръчно.
-- Поставете целия файл в Supabase → SQL Editor → Run. Пуска се ЕДИН път на празен проект.

-- ===== supabase/migrations/20260101000001_core.sql =====
-- =====================================================================
-- 0001 ЯДРО: хора, роли, структура (отдели → екипи → позиции), одит
-- =====================================================================
-- Ролите в системата:
--   admin       – Администратор: хора, роли, права, структура, настройки
--   leadership  – Ръководство: вижда всичко
--   member      – Член / доброволец (лидерството на екип е отделно – team_members.is_leader)
-- Сигурността е в базата (Row Level Security), не само в интерфейса.
-- =====================================================================

create extension if not exists btree_gist with schema extensions;

create type public.person_status as enum ('pending', 'active', 'inactive');
create type public.system_role   as enum ('admin', 'leadership', 'member');

-- ---------------------------------------------------------------------
-- Настройки
-- ---------------------------------------------------------------------
create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values
  ('org_name', '"Нашата организация"'),
  ('require_mfa_for_staff', 'true'),
  ('timezone', '"Europe/Sofia"');

-- ---------------------------------------------------------------------
-- Хора
-- ---------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  first_name    text not null default '',
  last_name     text not null default '',
  phone         text,
  avatar_url    text,
  birthday      date,
  tshirt_size   text check (tshirt_size in ('XS','S','M','L','XL','XXL','XXXL')),
  skills        text[] not null default '{}',
  status        public.person_status not null default 'pending',
  system_role   public.system_role not null default 'member',
  gdpr_consent_at timestamptz,
  approved_at   timestamptz,
  approved_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index profiles_status_idx on public.profiles (status);
create index profiles_name_idx on public.profiles (lower(first_name || ' ' || last_name));

-- Бележки за човека – вижда ги само ръководството
create table public.profile_notes (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  body       text not null,
  author_id  uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.profile_notes (profile_id);

-- ---------------------------------------------------------------------
-- Структура
-- ---------------------------------------------------------------------
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique,               -- 'leadership', 'kids' и т.н. (ползва се от логиката)
  name        text not null,
  description text,
  color       text not null default '#6366f1',
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

create table public.teams (
  id                uuid primary key default gen_random_uuid(),
  department_id     uuid not null references public.departments (id) on delete cascade,
  name              text not null,
  description       text,
  sort              int not null default 0,
  allow_self_signup boolean not null default false,  -- доброволците могат сами да се запишат на позиция
  -- допълнителни права за членовете на екипа:
  --   events, registrations, checkins, rooms, gifts, announcements
  permissions       text[] not null default '{}',
  min_age           int,                              -- за детските групи
  max_age           int,
  created_at        timestamptz not null default now()
);
create index on public.teams (department_id);

create table public.positions (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  name          text not null,
  description   text,
  default_count int not null default 1 check (default_count >= 0),
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);
create index on public.positions (team_id);

create table public.team_members (
  team_id    uuid not null references public.teams (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  is_leader  boolean not null default false,
  joined_at  timestamptz not null default now(),
  primary key (team_id, profile_id)
);
create index on public.team_members (profile_id);

-- Лидер на цял отдел (напр. „Главен лидер“ на детското служение)
create table public.department_leaders (
  department_id uuid not null references public.departments (id) on delete cascade,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  primary key (department_id, profile_id)
);

-- Позиции, на които човекът може да служи
create table public.member_positions (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  position_id uuid not null references public.positions (id) on delete cascade,
  primary key (profile_id, position_id)
);
create index on public.member_positions (position_id);

-- ---------------------------------------------------------------------
-- Подаръци и покупки
-- ---------------------------------------------------------------------
create table public.gifts (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind       text not null default 'gift' check (kind in ('gift','purchase')),
  category   text not null default 'other' check (category in ('book','tshirt','other')),
  item_name  text not null,
  given_on   date not null default current_date,
  price      numeric(10,2),
  notes      text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.gifts (profile_id);
create index on public.gifts (lower(item_name));

-- ---------------------------------------------------------------------
-- Одитен журнал (само добавяне)
-- ---------------------------------------------------------------------
create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor_id   uuid,
  table_name text not null,
  row_id     text,
  action     text not null,
  old_data   jsonb,
  new_data   jsonb
);
create index on public.audit_log (at desc);
create index on public.audit_log (table_name, row_id);

-- GDPR заявки (експорт / изтриване)
create table public.data_requests (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('export','delete')),
  status     text not null default 'open' check (status in ('open','done','rejected')),
  note       text,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.profiles (id) on delete set null
);

-- =====================================================================
-- ПОМОЩНИ ФУНКЦИИ ЗА ПРАВАТА (security definer → без рекурсия в RLS)
-- =====================================================================

create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value)::text::boolean from public.app_settings where key = 'require_mfa_for_staff'), true) = false
      or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and status = 'active' and system_role = 'admin')
         and public.mfa_ok();
$$;

-- Само ръководството (без администратора) – за поверителните бележки
create or replace function public.is_leadership() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and status = 'active' and system_role = 'leadership')
         and public.mfa_ok();
$$;

-- Ръководство или администратор – вижда всичко
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and status = 'active' and system_role in ('admin','leadership'))
         and public.mfa_ok();
$$;

create or replace function public.my_team_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select tm.team_id from public.team_members tm
  join public.profiles p on p.id = tm.profile_id and p.status = 'active'
  where tm.profile_id = auth.uid();
$$;

create or replace function public.is_team_member(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members tm
                 join public.profiles p on p.id = tm.profile_id and p.status = 'active'
                 where tm.team_id = p_team and tm.profile_id = auth.uid());
$$;

create or replace function public.is_department_leader(p_department uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.department_leaders dl
                 join public.profiles p on p.id = dl.profile_id and p.status = 'active'
                 where dl.department_id = p_department and dl.profile_id = auth.uid());
$$;

-- Лидер на екипа (или лидер на отдела, в който е екипът)
create or replace function public.is_team_leader(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members tm
                 join public.profiles p on p.id = tm.profile_id and p.status = 'active'
                 where tm.team_id = p_team and tm.profile_id = auth.uid() and tm.is_leader)
      or exists (select 1 from public.teams t
                 join public.department_leaders dl on dl.department_id = t.department_id
                 join public.profiles p on p.id = dl.profile_id and p.status = 'active'
                 where t.id = p_team and dl.profile_id = auth.uid());
$$;

create or replace function public.my_led_team_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select t.id from public.teams t where public.is_team_leader(t.id);
$$;

create or replace function public.can_manage_team(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() or public.is_team_leader(p_team);
$$;

-- Има ли човекът общ екип с мен
create or replace function public.shares_team(p_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members a
                 join public.team_members b on b.team_id = a.team_id
                 where a.profile_id = auth.uid() and b.profile_id = p_profile)
         and public.is_active_user();
$$;

-- Водя ли екип, в който е човекът
create or replace function public.leads_person(p_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members b
                 where b.profile_id = p_profile and public.is_team_leader(b.team_id));
$$;

-- Допълнително право, дадено на екип (events, registrations, checkins, rooms, gifts, announcements)
create or replace function public.has_permission(p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff()
      or exists (select 1 from public.team_members tm
                 join public.teams t on t.id = tm.team_id
                 join public.profiles p on p.id = tm.profile_id and p.status = 'active'
                 where tm.profile_id = auth.uid() and p_perm = any (t.permissions));
$$;

create or replace function public.is_any_leader() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members tm join public.profiles p on p.id = tm.profile_id and p.status='active'
                 where tm.profile_id = auth.uid() and tm.is_leader)
      or exists (select 1 from public.department_leaders dl join public.profiles p on p.id = dl.profile_id and p.status='active'
                 where dl.profile_id = auth.uid());
$$;

-- Търсене на хора за добавяне в екип (само име) – за лидери и администратори
create or replace function public.search_people(p_query text)
returns table (id uuid, first_name text, last_name text, email text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.first_name, p.last_name,
         case when public.is_staff() then p.email else null end
  from public.profiles p
  where p.status = 'active'
    and (public.is_staff() or public.is_any_leader())
    and (p_query is null or p_query = ''
         or lower(p.first_name || ' ' || p.last_name || ' ' || p.email) like '%' || lower(p_query) || '%')
  order by p.first_name, p.last_name
  limit 30;
$$;

-- =====================================================================
-- ТРИГЕРИ
-- =====================================================================

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Нов потребител от Supabase Auth → профил със статус „чака одобрение“
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, first_name, last_name, phone, status, gdpr_consent_at)
  values (new.id, coalesce(new.email, ''),
          coalesce(new.raw_user_meta_data ->> 'first_name', ''),
          coalesce(new.raw_user_meta_data ->> 'last_name', ''),
          nullif(new.raw_user_meta_data ->> 'phone', ''),
          'pending',
          case when (new.raw_user_meta_data ->> 'gdpr_consent') = 'true' then now() end)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Само администраторът може да променя статус, роля и имейл
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;  -- системни операции (service role / SQL)
  if not public.is_admin() then
    if new.status is distinct from old.status
       or new.system_role is distinct from old.system_role
       or new.email is distinct from old.email
       or new.approved_at is distinct from old.approved_at
       or new.approved_by is distinct from old.approved_by then
      raise exception 'Само администраторът може да променя статус, роля и имейл';
    end if;
  else
    if new.status = 'active' and old.status = 'pending' then
      new.approved_at := now();
      new.approved_by := auth.uid();
    end if;
    -- последният администратор не може да си свали правата
    if old.system_role = 'admin' and new.system_role <> 'admin' and old.id = auth.uid()
       and (select count(*) from public.profiles where system_role = 'admin' and status = 'active') <= 1 then
      raise exception 'Не можете да премахнете последния администратор';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- Само администраторът дава лидерство в екип
create or replace function public.team_members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_admin() then return coalesce(new, old); end if;
  if tg_op = 'INSERT' and new.is_leader then
    raise exception 'Само администраторът може да определя лидери';
  end if;
  if tg_op = 'UPDATE' and new.is_leader is distinct from old.is_leader then
    raise exception 'Само администраторът може да определя лидери';
  end if;
  if tg_op = 'DELETE' and old.is_leader then
    raise exception 'Само администраторът може да премахва лидери';
  end if;
  return coalesce(new, old);
end $$;

create trigger team_members_guard before insert or update or delete on public.team_members
  for each row execute function public.team_members_guard();

-- Одит
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_log (actor_id, table_name, row_id, action, old_data, new_data)
  values (auth.uid(), tg_table_name,
          coalesce(r ->> 'id', r ->> 'child_id', r ->> 'profile_id', r ->> 'key'),
          tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create or replace function public.enable_audit(p_table regclass) returns void
language plpgsql as $$
begin
  execute format('create trigger audit_%s after insert or update or delete on %s for each row execute function public.audit_trigger()',
                 replace(p_table::text, 'public.', ''), p_table);
end $$;

select public.enable_audit(t) from unnest(array[
  'public.profiles','public.profile_notes','public.departments','public.teams','public.positions',
  'public.team_members','public.department_leaders','public.member_positions','public.gifts',
  'public.app_settings','public.data_requests'
]::regclass[]) t;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.app_settings       enable row level security;
alter table public.profiles           enable row level security;
alter table public.profile_notes      enable row level security;
alter table public.departments        enable row level security;
alter table public.teams              enable row level security;
alter table public.positions          enable row level security;
alter table public.team_members       enable row level security;
alter table public.department_leaders enable row level security;
alter table public.member_positions   enable row level security;
alter table public.gifts              enable row level security;
alter table public.audit_log          enable row level security;
alter table public.data_requests      enable row level security;

-- Настройки
create policy settings_read  on public.app_settings for select to authenticated using (public.is_active_user());
create policy settings_write on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Профили: себе си; ръководство/админ – всички; останалите – само хора от общ екип
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff() or public.shares_team(id) or public.leads_person(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy profiles_delete on public.profiles for delete to authenticated using (public.is_admin());

-- Бележки – само ръководството
create policy notes_all on public.profile_notes for all to authenticated
  using (public.is_leadership()) with check (public.is_leadership());

-- Структурата се вижда от всички активни, редактира се от администратора
create policy departments_read  on public.departments for select to authenticated using (public.is_active_user());
create policy departments_write on public.departments for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy teams_read  on public.teams for select to authenticated using (public.is_active_user());
create policy teams_write on public.teams for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy positions_read  on public.positions for select to authenticated using (public.is_active_user());
create policy positions_write on public.positions for all to authenticated
  using (public.is_admin() or public.is_team_leader(team_id)) with check (public.is_admin() or public.is_team_leader(team_id));

-- Членство: вижда се от членовете на същия екип; управлява се от админ и лидера на екипа
create policy tm_select on public.team_members for select to authenticated
  using (profile_id = auth.uid() or public.is_staff() or public.is_team_member(team_id) or public.is_team_leader(team_id));
create policy tm_write on public.team_members for all to authenticated
  using (public.is_admin() or public.is_team_leader(team_id)) with check (public.is_admin() or public.is_team_leader(team_id));

create policy dl_select on public.department_leaders for select to authenticated using (public.is_active_user());
create policy dl_write  on public.department_leaders for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy mp_select on public.member_positions for select to authenticated
  using (profile_id = auth.uid() or public.is_staff()
         or exists (select 1 from public.positions p where p.id = position_id
                    and (public.is_team_member(p.team_id) or public.is_team_leader(p.team_id))));
create policy mp_write on public.member_positions for all to authenticated
  using (public.is_admin() or exists (select 1 from public.positions p where p.id = position_id and public.is_team_leader(p.team_id)))
  with check (public.is_admin() or exists (select 1 from public.positions p where p.id = position_id and public.is_team_leader(p.team_id)));

-- Подаръци: ръководство и екипи с право „gifts“ (напр. Книжарница); човекът вижда своите
create policy gifts_select on public.gifts for select to authenticated
  using (profile_id = auth.uid() or public.has_permission('gifts'));
create policy gifts_write on public.gifts for all to authenticated
  using (public.has_permission('gifts')) with check (public.has_permission('gifts'));

-- Одитен журнал – само администраторът чете; никой не редактира
create policy audit_select on public.audit_log for select to authenticated using (public.is_admin());

-- GDPR заявки
create policy dr_select on public.data_requests for select to authenticated using (profile_id = auth.uid() or public.is_admin());
create policy dr_insert on public.data_requests for insert to authenticated with check (profile_id = auth.uid());
create policy dr_update on public.data_requests for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Предупреждение за повтарящ се подарък
create or replace function public.gift_duplicates(p_profile uuid, p_item text)
returns table (id uuid, item_name text, given_on date, kind text)
language sql stable security invoker set search_path = '' as $$
  select g.id, g.item_name, g.given_on, g.kind from public.gifts g
  where g.profile_id = p_profile
    and length(trim(p_item)) >= 3
    and (strpos(lower(g.item_name), lower(trim(p_item))) > 0
         or strpos(lower(trim(p_item)), lower(g.item_name)) > 0)
  order by g.given_on desc;
$$;

-- ===== supabase/migrations/20260101000002_services.sql =====
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

-- ===== supabase/migrations/20260101000003_registrations.sql =====
-- =====================================================================
-- 0003 РЕГИСТРАЦИИ ЗА СЪБИТИЯ (публични, без акаунт)
-- =====================================================================

create type public.registration_status as enum ('confirmed', 'waitlist', 'cancelled');

create table public.reg_events (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid references public.events (id) on delete set null,
  slug              text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  title             text not null,
  description       text,
  location          text,
  starts_at         timestamptz,
  capacity          int not null default 100 check (capacity >= 0),
  is_published      boolean not null default false,
  is_open           boolean not null default true,
  closes_at         timestamptz,
  use_seating       boolean not null default false,  -- схема на залата – по избор
  seat_rows         int check (seat_rows between 1 and 60),
  seats_per_row     int check (seats_per_row between 1 and 80),
  blocked_seats     text[] not null default '{}',    -- формат „ред-място“, напр. '1-5'
  -- персонализирани въпроси: [{ "id": "q1", "label": "…", "type": "text|textarea|select|checkbox", "options": [], "required": true }]
  questions         jsonb not null default '[]',
  confirmation_text text,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now()
);

create table public.registrations (
  id            uuid primary key default gen_random_uuid(),
  reg_event_id  uuid not null references public.reg_events (id) on delete cascade,
  first_name    text not null,
  last_name     text not null,
  email         text not null,
  phone         text,
  answers       jsonb not null default '{}',
  status        public.registration_status not null,
  seat_row      int,
  seat_number   int,
  qr_token      uuid not null unique default gen_random_uuid(),
  cancel_token  uuid not null unique default gen_random_uuid(),
  consent_at    timestamptz not null default now(),
  checked_in_at timestamptz,
  checked_in_by uuid references public.profiles (id) on delete set null,
  promoted_at   timestamptz,
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index on public.registrations (reg_event_id, status, created_at);
-- Защита от двойно заемане на едно място
create unique index registrations_seat_uq on public.registrations (reg_event_id, seat_row, seat_number)
  where status = 'confirmed' and seat_row is not null;
-- Един имейл – една активна регистрация за събитие
create unique index registrations_email_uq on public.registrations (reg_event_id, lower(email))
  where status <> 'cancelled';

select public.enable_audit(t) from unnest(array['public.reg_events','public.registrations']::regclass[]) t;

alter table public.reg_events    enable row level security;
alter table public.registrations enable row level security;

-- Публикуваните регистрации се виждат от всички (и без вход)
create policy reg_events_public on public.reg_events for select to anon, authenticated
  using (is_published or public.has_permission('registrations'));
create policy reg_events_write on public.reg_events for all to authenticated
  using (public.has_permission('registrations')) with check (public.has_permission('registrations'));

-- Личните данни на регистрираните – само за отговорните
create policy registrations_read on public.registrations for select to authenticated
  using (public.has_permission('registrations'));
create policy registrations_update on public.registrations for update to authenticated
  using (public.has_permission('registrations')) with check (public.has_permission('registrations'));
create policy registrations_delete on public.registrations for delete to authenticated
  using (public.has_permission('registrations'));

-- ---------------------------------------------------------------------
-- Заети места (без лични данни)
-- ---------------------------------------------------------------------
create or replace function public.reg_taken_seats(p_slug text)
returns table (seat_row int, seat_number int)
language sql stable security definer set search_path = '' as $$
  select r.seat_row, r.seat_number from public.registrations r
  join public.reg_events e on e.id = r.reg_event_id
  where e.slug = p_slug and e.is_published and r.status = 'confirmed' and r.seat_row is not null;
$$;

create or replace function public.reg_counts(p_slug text)
returns table (confirmed bigint, waitlist bigint, capacity int)
language sql stable security definer set search_path = '' as $$
  select count(*) filter (where r.status = 'confirmed'), count(*) filter (where r.status = 'waitlist'), e.capacity
  from public.reg_events e left join public.registrations r on r.reg_event_id = e.id
  where e.slug = p_slug and (e.is_published or public.has_permission('registrations'))
  group by e.capacity;
$$;

-- ---------------------------------------------------------------------
-- Публична регистрация (атомарно, със заключване)
-- ---------------------------------------------------------------------
create or replace function public.public_register(
  p_slug text, p_first_name text, p_last_name text, p_email text, p_phone text,
  p_answers jsonb default '{}', p_seat_row int default null, p_seat_number int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e record; q jsonb; cnt int; st public.registration_status; reg record;
begin
  select * into e from public.reg_events where slug = p_slug for update;  -- заключване срещу едновременни записи
  if not found or not e.is_published then raise exception 'Регистрацията не е намерена'; end if;
  if not e.is_open or (e.closes_at is not null and e.closes_at < now()) then
    raise exception 'Регистрацията е затворена';
  end if;
  if coalesce(trim(p_first_name), '') = '' or coalesce(trim(p_last_name), '') = '' then
    raise exception 'Моля, въведете име и фамилия';
  end if;
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Невалиден имейл'; end if;

  for q in select * from jsonb_array_elements(e.questions) loop
    if coalesce((q ->> 'required')::boolean, false)
       and coalesce(trim(p_answers ->> (q ->> 'id')), '') in ('', 'false') then
      raise exception 'Моля, отговорете на: %', q ->> 'label';
    end if;
  end loop;

  if exists (select 1 from public.registrations where reg_event_id = e.id
             and lower(email) = lower(trim(p_email)) and status <> 'cancelled') then
    raise exception 'Вече има регистрация с този имейл';
  end if;

  select count(*) into cnt from public.registrations where reg_event_id = e.id and status = 'confirmed';
  st := case when cnt < e.capacity then 'confirmed' else 'waitlist' end;

  if st = 'confirmed' and e.use_seating then
    if p_seat_row is null or p_seat_number is null then raise exception 'Моля, изберете място'; end if;
    if p_seat_row < 1 or p_seat_row > e.seat_rows or p_seat_number < 1 or p_seat_number > e.seats_per_row
       or (p_seat_row || '-' || p_seat_number) = any (e.blocked_seats) then
      raise exception 'Невалидно място';
    end if;
    if exists (select 1 from public.registrations where reg_event_id = e.id and status = 'confirmed'
               and seat_row = p_seat_row and seat_number = p_seat_number) then
      raise exception 'Мястото току-що беше заето. Моля, изберете друго.';
    end if;
  end if;

  insert into public.registrations (reg_event_id, first_name, last_name, email, phone, answers, status, seat_row, seat_number)
  values (e.id, trim(p_first_name), trim(p_last_name), lower(trim(p_email)), nullif(trim(p_phone), ''),
          coalesce(p_answers, '{}'), st,
          case when st = 'confirmed' and e.use_seating then p_seat_row end,
          case when st = 'confirmed' and e.use_seating then p_seat_number end)
  returning * into reg;

  return jsonb_build_object('id', reg.id, 'status', reg.status, 'qr_token', reg.qr_token,
    'cancel_token', reg.cancel_token, 'seat_row', reg.seat_row, 'seat_number', reg.seat_number,
    'waitlist_position', case when st = 'waitlist' then
      (select count(*) from public.registrations where reg_event_id = e.id and status = 'waitlist') end);
end $$;

-- Вътрешна: отказ + автоматично повишаване на първия от списъка на изчакване
create or replace function public._cancel_registration(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record; e record; nxt record; s_row int; s_num int;
begin
  select * into r from public.registrations where id = p_id;
  if not found then raise exception 'Регистрацията не е намерена'; end if;
  select * into e from public.reg_events where id = r.reg_event_id for update;
  if r.status = 'cancelled' then return jsonb_build_object('promoted', null); end if;

  update public.registrations set status = 'cancelled', cancelled_at = now(),
         seat_row = null, seat_number = null where id = r.id;

  if r.status = 'confirmed'
     and (select count(*) from public.registrations where reg_event_id = e.id and status = 'confirmed') < e.capacity then
    select * into nxt from public.registrations where reg_event_id = e.id and status = 'waitlist'
      order by created_at limit 1 for update skip locked;
    if found then
      s_row := r.seat_row; s_num := r.seat_number;
      if e.use_seating and s_row is null then
        select gs.r, gs.n into s_row, s_num
        from generate_series(1, e.seat_rows) gs(r) cross join lateral generate_series(1, e.seats_per_row) n(n)
        where not ((gs.r || '-' || n.n) = any (e.blocked_seats))
          and not exists (select 1 from public.registrations x where x.reg_event_id = e.id and x.status = 'confirmed'
                          and x.seat_row = gs.r and x.seat_number = n.n)
        order by gs.r, n.n limit 1;
      end if;
      update public.registrations set status = 'confirmed', promoted_at = now(),
             seat_row = case when e.use_seating then s_row end,
             seat_number = case when e.use_seating then s_num end
       where id = nxt.id;
      return jsonb_build_object('promoted', nxt.id);
    end if;
  end if;
  return jsonb_build_object('promoted', null);
end $$;
revoke all on function public._cancel_registration(uuid) from public, anon, authenticated;

-- Отказ от самия регистриран (по линка от имейла)
create or replace function public.public_cancel_registration(p_cancel_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  select id into rid from public.registrations where cancel_token = p_cancel_token;
  if rid is null then raise exception 'Регистрацията не е намерена'; end if;
  return public._cancel_registration(rid);
end $$;

-- Отказ от отговорник
create or replace function public.staff_cancel_registration(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_permission('registrations') then raise exception 'Нямате права'; end if;
  return public._cancel_registration(p_id);
end $$;

-- При увеличен капацитет – повишаване на чакащите
create or replace function public.promote_waitlist(p_reg_event uuid)
returns setof uuid language plpgsql security definer set search_path = '' as $$
declare e record; nxt record; s_row int; s_num int;
begin
  if not public.has_permission('registrations') then raise exception 'Нямате права'; end if;
  select * into e from public.reg_events where id = p_reg_event for update;
  loop
    exit when (select count(*) from public.registrations where reg_event_id = e.id and status = 'confirmed') >= e.capacity;
    select * into nxt from public.registrations where reg_event_id = e.id and status = 'waitlist' order by created_at limit 1;
    exit when not found;
    s_row := null; s_num := null;
    if e.use_seating then
      select gs.r, n.n into s_row, s_num
      from generate_series(1, e.seat_rows) gs(r) cross join lateral generate_series(1, e.seats_per_row) n(n)
      where not ((gs.r || '-' || n.n) = any (e.blocked_seats))
        and not exists (select 1 from public.registrations x where x.reg_event_id = e.id and x.status = 'confirmed'
                        and x.seat_row = gs.r and x.seat_number = n.n)
      order by gs.r, n.n limit 1;
      exit when s_row is null;
    end if;
    update public.registrations set status = 'confirmed', promoted_at = now(), seat_row = s_row, seat_number = s_num
     where id = nxt.id;
    return next nxt.id;
  end loop;
end $$;

-- Публичен билет по QR токен (без чужди данни)
create or replace function public.public_ticket(p_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('first_name', r.first_name, 'last_name', r.last_name, 'status', r.status,
    'seat_row', r.seat_row, 'seat_number', r.seat_number, 'qr_token', r.qr_token, 'cancel_token', r.cancel_token,
    'title', e.title, 'starts_at', e.starts_at, 'location', e.location, 'slug', e.slug,
    'waitlist_position', case when r.status = 'waitlist' then
       (select count(*) from public.registrations w where w.reg_event_id = e.id and w.status = 'waitlist' and w.created_at <= r.created_at) end)
  from public.registrations r join public.reg_events e on e.id = r.reg_event_id
  where r.qr_token = p_token or r.cancel_token = p_token;
$$;

-- Сканиране на входа
create or replace function public.checkin_registration(p_qr uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if not public.has_permission('registrations') then raise exception 'Нямате права'; end if;
  select reg.*, e.title into r from public.registrations reg join public.reg_events e on e.id = reg.reg_event_id
   where reg.qr_token = p_qr;
  if not found then return jsonb_build_object('ok', false, 'message', 'Невалиден код'); end if;
  if r.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'message', case r.status when 'waitlist' then 'В списъка на изчакване' else 'Отказана регистрация' end,
                              'name', r.first_name || ' ' || r.last_name, 'title', r.title);
  end if;
  if r.checked_in_at is not null then
    return jsonb_build_object('ok', false, 'message', 'Вече е влязъл(а) в ' || to_char(r.checked_in_at at time zone 'Europe/Sofia', 'HH24:MI'),
                              'name', r.first_name || ' ' || r.last_name, 'title', r.title, 'already', true);
  end if;
  update public.registrations set checked_in_at = now(), checked_in_by = auth.uid() where id = r.id;
  return jsonb_build_object('ok', true, 'message', 'Добре дошли!', 'name', r.first_name || ' ' || r.last_name,
                            'title', r.title, 'seat_row', r.seat_row, 'seat_number', r.seat_number, 'reg_event_id', r.reg_event_id);
end $$;

grant execute on function public.public_register(text, text, text, text, text, jsonb, int, int) to anon, authenticated;
grant execute on function public.public_cancel_registration(uuid) to anon, authenticated;
grant execute on function public.public_ticket(uuid) to anon, authenticated;
grant execute on function public.reg_taken_seats(text) to anon, authenticated;
grant execute on function public.reg_counts(text) to anon, authenticated;

-- ===== supabase/migrations/20260101000004_kids_tasks_comms.sql =====
-- =====================================================================
-- 0004 ДЕТСКО СЛУЖЕНИЕ, ЗАДАЧИ И ЧЕКЛИСТИ, КОМУНИКАЦИЯ, ОТЧЕТИ
-- =====================================================================

-- ---------------------------------------------------------------------
-- ДЕТСКО СЛУЖЕНИЕ (GDPR: минимум данни, достъп само за нуждаещите се)
-- ---------------------------------------------------------------------
create table public.children (
  id              uuid primary key default gen_random_uuid(),
  first_name      text not null,
  last_name       text not null,
  birthdate       date,
  group_team_id   uuid references public.teams (id) on delete set null,  -- възрастова група
  photo_consent   boolean not null default false,
  consent_at      timestamptz,               -- съгласие на родителя за обработка на данните
  consent_by_name text,
  is_active       boolean not null default true,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index on public.children (lower(first_name || ' ' || last_name));

-- Чувствителни данни – само учителите на групата и главният лидер
create table public.child_care (
  child_id      uuid primary key references public.children (id) on delete cascade,
  allergies     text,
  medical_notes text,
  notes         text,
  updated_at    timestamptz not null default now()
);

create table public.guardians (
  id         uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name  text not null,
  phone      text,
  email      text,
  profile_id uuid references public.profiles (id) on delete set null,  -- ако родителят има акаунт
  created_at timestamptz not null default now()
);
create index on public.guardians (phone);

create table public.child_guardians (
  child_id     uuid not null references public.children (id) on delete cascade,
  guardian_id  uuid not null references public.guardians (id) on delete cascade,
  relationship text not null default 'родител',
  can_pick_up  boolean not null default true,
  primary key (child_id, guardian_id)
);

create table public.checkins (
  id             uuid primary key default gen_random_uuid(),
  child_id       uuid not null references public.children (id) on delete cascade,
  group_team_id  uuid references public.teams (id) on delete set null,
  event_id       uuid references public.events (id) on delete set null,
  security_code  text not null,
  checked_in_at  timestamptz not null default now(),
  checked_in_by  uuid references public.profiles (id) on delete set null,
  checked_out_at timestamptz,
  checked_out_by uuid references public.profiles (id) on delete set null,
  picked_up_by   text
);
create index on public.checkins (checked_in_at desc);
create index on public.checkins (child_id);
-- едно дете – едно отворено регистриране
create unique index checkins_open_uq on public.checkins (child_id) where checked_out_at is null;

create or replace function public.kids_department_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.departments where slug = 'kids' limit 1;
$$;

-- Член на детското служение или екип с право „checkins“ (вход)
create or replace function public.is_kids_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_permission('checkins')
      or public.is_department_leader(public.kids_department_id())
      or exists (select 1 from public.teams t where t.department_id = public.kids_department_id()
                 and public.is_team_member(t.id));
$$;

-- Учител в групата на детето (или главен лидер)
create or replace function public.can_see_child_care(p_child uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_department_leader(public.kids_department_id())
      or exists (select 1 from public.children c where c.id = p_child and c.group_team_id is not null
                 and public.is_team_member(c.group_team_id));
$$;

create or replace function public.is_guardian_of(p_child uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.child_guardians cg join public.guardians g on g.id = cg.guardian_id
                 where cg.child_id = p_child and g.profile_id = auth.uid());
$$;

-- Дали има алергии/бележки (за знак на етикета, без да се показва съдържанието)
create or replace function public.child_has_alerts(p_child uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_kids_staff() and exists (select 1 from public.child_care where child_id = p_child
         and (coalesce(trim(allergies), '') <> '' or coalesce(trim(medical_notes), '') <> ''));
$$;

-- Регистриране на дете при пристигане – генерира код за родителя
create or replace function public.kids_check_in(p_child uuid, p_event uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c record; code text := ''; alphabet text := 'ACDEFHJKLMNPRTUVWXY3479'; i int; rec record;
begin
  if not public.is_kids_staff() then raise exception 'Нямате права'; end if;
  select * into c from public.children where id = p_child and is_active;
  if not found then raise exception 'Детето не е намерено'; end if;
  if exists (select 1 from public.checkins where child_id = p_child and checked_out_at is null) then
    raise exception '% вече е регистриран(а)', c.first_name;
  end if;
  for i in 1..4 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  insert into public.checkins (child_id, group_team_id, event_id, security_code, checked_in_by)
  values (c.id, c.group_team_id, p_event, code, auth.uid()) returning * into rec;
  return jsonb_build_object('id', rec.id, 'code', code);
end $$;

-- Взимане на детето – само с правилния код
create or replace function public.kids_check_out(p_checkin uuid, p_code text, p_picked_up_by text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if not public.is_kids_staff() then raise exception 'Нямате права'; end if;
  select * into r from public.checkins where id = p_checkin;
  if not found or r.checked_out_at is not null then raise exception 'Няма активно регистриране'; end if;
  if upper(trim(p_code)) <> r.security_code then
    return jsonb_build_object('ok', false, 'message', 'Грешен код! Не предавайте детето.');
  end if;
  update public.checkins set checked_out_at = now(), checked_out_by = auth.uid(), picked_up_by = p_picked_up_by
   where id = r.id;
  return jsonb_build_object('ok', true, 'message', 'Детето е предадено');
end $$;

-- Автоматична група по възраст
create or replace function public.child_auto_group() returns trigger
language plpgsql security definer set search_path = '' as $$
declare age int;
begin
  if new.group_team_id is null and new.birthdate is not null then
    age := extract(year from age(current_date, new.birthdate))::int;
    select id into new.group_team_id from public.teams
     where department_id = public.kids_department_id() and min_age is not null
       and age between min_age and max_age
     order by min_age limit 1;
  end if;
  return new;
end $$;
create trigger children_auto_group before insert or update of birthdate on public.children
  for each row execute function public.child_auto_group();

-- ---------------------------------------------------------------------
-- ЗАДАЧИ И ЧЕКЛИСТИ
-- ---------------------------------------------------------------------
create type public.recurrence as enum ('none', 'daily', 'weekly', 'monthly');
create type public.task_status as enum ('open', 'in_progress', 'done');

create table public.checklist_templates (
  id                  uuid primary key default gen_random_uuid(),
  team_id             uuid not null references public.teams (id) on delete cascade,
  title               text not null,
  description         text,
  recurrence          public.recurrence not null default 'weekly',
  weekday             smallint check (weekday between 1 and 7),
  month_day           smallint check (month_day between 1 and 28),
  due_time            time not null default '18:00',
  default_assignee_id uuid references public.profiles (id) on delete set null,
  is_active           boolean not null default true,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now()
);

create table public.checklist_template_items (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid not null references public.checklist_templates (id) on delete cascade,
  sort           int not null default 0,
  title          text not null,
  requires_photo boolean not null default false
);

create table public.checklists (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid references public.checklist_templates (id) on delete set null,
  team_id      uuid not null references public.teams (id) on delete cascade,
  event_id     uuid references public.events (id) on delete set null,
  title        text not null,
  due_at       timestamptz,
  assignee_id  uuid references public.profiles (id) on delete set null,
  period_key   text,
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (template_id, period_key)
);
create index on public.checklists (team_id, due_at);

create table public.checklist_items (
  id             uuid primary key default gen_random_uuid(),
  checklist_id   uuid not null references public.checklists (id) on delete cascade,
  sort           int not null default 0,
  title          text not null,
  requires_photo boolean not null default false,
  done_at        timestamptz,
  done_by        uuid references public.profiles (id) on delete set null,
  photo_path     text,
  note           text
);
create index on public.checklist_items (checklist_id);

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid references public.teams (id) on delete cascade,
  title        text not null,
  description  text,
  due_at       timestamptz,
  assignee_id  uuid references public.profiles (id) on delete set null,
  status       public.task_status not null default 'open',
  is_issue     boolean not null default false,  -- сигнал за повреда
  location     text,
  priority     smallint not null default 2 check (priority between 1 and 3),  -- 1 спешно, 2 нормално, 3 ниско
  photo_path   text,      -- снимка на повредата
  proof_path   text,      -- снимка като доказателство за изпълнение
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index on public.tasks (team_id, status);
create index on public.tasks (assignee_id, status);

-- Генериране на повтарящите се чеклисти (вика се всеки ден от cron и от бутон)
create or replace function public.generate_due_checklists(p_days_ahead int default 7)
returns int language plpgsql security definer set search_path = '' as $$
declare
  t record; d date; key text; cid uuid; n int := 0;
begin
  for t in select * from public.checklist_templates where is_active and recurrence <> 'none' loop
    for d in select generate_series(current_date, current_date + p_days_ahead, '1 day')::date loop
      continue when t.recurrence = 'weekly'  and extract(isodow from d) <> coalesce(t.weekday, 1);
      continue when t.recurrence = 'monthly' and extract(day from d) <> coalesce(t.month_day, 1);
      key := to_char(d, 'YYYY-MM-DD');
      insert into public.checklists (template_id, team_id, title, due_at, assignee_id, period_key)
      values (t.id, t.team_id, t.title, (d + t.due_time) at time zone 'Europe/Sofia', t.default_assignee_id, key)
      on conflict (template_id, period_key) do nothing
      returning id into cid;
      if cid is not null then
        insert into public.checklist_items (checklist_id, sort, title, requires_photo)
        select cid, sort, title, requires_photo from public.checklist_template_items where template_id = t.id;
        n := n + 1; cid := null;
      end if;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.generate_due_checklists(int) from public, anon;

create or replace function public.generate_team_checklists(p_team uuid)
returns int language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_team(p_team) then raise exception 'Нямате права'; end if;
  return public.generate_due_checklists(7);
end $$;

-- Чеклистът се отбелязва като завършен, когато всички точки са готови
create or replace function public.checklist_autocomplete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.checklists c
     set completed_at = case when not exists (select 1 from public.checklist_items i where i.checklist_id = c.id and i.done_at is null)
                             then coalesce(c.completed_at, now()) end,
         completed_by = case when not exists (select 1 from public.checklist_items i where i.checklist_id = c.id and i.done_at is null)
                             then coalesce(c.completed_by, auth.uid()) end
   where c.id = new.checklist_id;
  return new;
end $$;
create trigger checklist_items_done after update of done_at on public.checklist_items
  for each row execute function public.checklist_autocomplete();

-- Изисква ли се снимка
create or replace function public.checklist_item_guard() returns trigger
language plpgsql as $$
begin
  if new.done_at is not null and old.done_at is null and new.requires_photo and new.photo_path is null then
    raise exception 'За тази точка е нужна снимка като доказателство';
  end if;
  if new.done_at is not null and old.done_at is null then new.done_by := auth.uid(); end if;
  if not public.can_manage_team((select team_id from public.checklists where id = new.checklist_id)) then
    if new.title <> old.title or new.requires_photo <> old.requires_photo or new.sort <> old.sort then
      raise exception 'Можете само да отбелязвате точките';
    end if;
  end if;
  return new;
end $$;
create trigger checklist_items_guard before update on public.checklist_items
  for each row execute function public.checklist_item_guard();

-- ---------------------------------------------------------------------
-- КОМУНИКАЦИЯ
-- ---------------------------------------------------------------------
create type public.audience as enum ('all', 'department', 'team', 'position');

create table public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  audience    public.audience not null default 'all',
  audience_id uuid,
  author_id   uuid references public.profiles (id) on delete set null,
  author_name text,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  check ((audience = 'all') = (audience_id is null))
);
create index on public.announcements (created_at desc);

create table public.team_messages (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  author_name text,
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index on public.team_messages (team_id, created_at desc);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  title      text not null,
  body       text,
  url        text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (profile_id, created_at desc);

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- Мога ли да виждам съобщението
create or replace function public.in_audience(p_audience public.audience, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active_user() and case p_audience
    when 'all' then true
    when 'department' then exists (select 1 from public.teams t where t.department_id = p_id and t.id in (select public.my_team_ids()))
                           or public.is_department_leader(p_id)
    when 'team' then public.is_team_member(p_id) or public.is_team_leader(p_id)
    when 'position' then exists (select 1 from public.member_positions mp where mp.position_id = p_id and mp.profile_id = auth.uid())
                         or exists (select 1 from public.positions p where p.id = p_id and public.is_team_leader(p.team_id))
  end;
$$;

-- Мога ли да пиша до тази аудитория
create or replace function public.can_announce(p_audience public.audience, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_permission('announcements') or case p_audience
    when 'all' then false
    when 'department' then public.is_department_leader(p_id)
    when 'team' then public.is_team_leader(p_id)
    when 'position' then exists (select 1 from public.positions p where p.id = p_id and public.is_team_leader(p.team_id))
  end;
$$;

-- Хората в аудиторията (за изпращане на push/имейл от сървъра)
create or replace function public.audience_members(p_audience public.audience, p_id uuid)
returns table (profile_id uuid) language sql stable security definer set search_path = '' as $$
  select distinct p.id from public.profiles p
  where p.status = 'active' and public.can_announce(p_audience, p_id) and case p_audience
    when 'all' then true
    when 'department' then exists (select 1 from public.team_members tm join public.teams t on t.id = tm.team_id
                                   where tm.profile_id = p.id and t.department_id = p_id)
    when 'team' then exists (select 1 from public.team_members tm where tm.profile_id = p.id and tm.team_id = p_id)
    when 'position' then exists (select 1 from public.member_positions mp where mp.profile_id = p.id and mp.position_id = p_id)
  end;
$$;

-- ---------------------------------------------------------------------
-- ОТЧЕТИ (security invoker → правата от RLS важат автоматично)
-- ---------------------------------------------------------------------
create or replace view public.v_unfilled_needs with (security_invoker = true) as
select n.id, n.event_id, e.title as event_title, e.starts_at, n.team_id, t.name as team_name,
       n.position_id, p.name as position_name, n.needed,
       count(a.id) filter (where a.status = 'confirmed') as confirmed,
       count(a.id) filter (where a.status = 'pending')   as pending,
       greatest(n.needed - count(a.id) filter (where a.status <> 'declined'), 0) as open_slots
from public.plan_needs n
join public.events e on e.id = n.event_id and not e.is_cancelled
join public.teams t on t.id = n.team_id
join public.positions p on p.id = n.position_id
left join public.assignments a on a.event_id = n.event_id and a.position_id = n.position_id
group by n.id, e.title, e.starts_at, t.name, p.name;

create or replace function public.upcoming_birthdays(p_days int default 14)
returns table (id uuid, first_name text, last_name text, avatar_url text, birthday date, next_date date, turns int)
language sql stable security invoker set search_path = '' as $$
  with b as (
    select p.*, make_date(extract(year from current_date)::int, extract(month from p.birthday)::int,
                 least(extract(day from p.birthday)::int, case when extract(month from p.birthday) = 2 then 28 else 31 end)) as d0
    from public.profiles p where p.birthday is not null and p.status = 'active'
  )
  select id, first_name, last_name, avatar_url, birthday,
         case when d0 < current_date then (d0 + interval '1 year')::date else d0 end as next_date,
         (extract(year from case when d0 < current_date then (d0 + interval '1 year')::date else d0 end) - extract(year from birthday))::int
  from b
  where (case when d0 < current_date then (d0 + interval '1 year')::date else d0 end) <= current_date + p_days
    and (public.is_staff() or public.leads_person(id))
  order by next_date;
$$;

create or replace function public.report_summary()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'active_people', (select count(*) from public.profiles where status = 'active'),
    'pending_people', (select count(*) from public.profiles where status = 'pending'),
    'active_volunteers_90d', (select count(distinct a.profile_id) from public.assignments a join public.events e on e.id = a.event_id
                              where a.status = 'confirmed' and e.starts_at > now() - interval '90 days' and e.starts_at < now()),
    'open_slots_14d', (select coalesce(sum(open_slots), 0) from public.v_unfilled_needs
                       where starts_at between now() and now() + interval '14 days'),
    'pending_invites', (select count(*) from public.assignments a join public.events e on e.id = a.event_id
                        where a.status = 'pending' and e.starts_at > now()),
    'kids_this_week', (select count(*) from public.checkins where checked_in_at > date_trunc('week', now())),
    'registrations_open', (select count(*) from public.registrations r join public.reg_events e on e.id = r.reg_event_id
                           where r.status = 'confirmed' and (e.starts_at is null or e.starts_at > now())),
    'open_issues', (select count(*) from public.tasks where is_issue and status <> 'done')
  );
$$;

create or replace function public.report_attendance(p_weeks int default 12)
returns table (week date, kids bigint, volunteers bigint, registrations bigint)
language sql stable security invoker set search_path = '' as $$
  with w as (select generate_series(date_trunc('week', now()) - make_interval(weeks => p_weeks - 1), date_trunc('week', now()), '1 week')::date as week)
  select w.week,
    (select count(*) from public.checkins c where c.checked_in_at >= w.week and c.checked_in_at < w.week + 7),
    (select count(distinct a.profile_id) from public.assignments a join public.events e on e.id = a.event_id
      where a.status = 'confirmed' and e.starts_at >= w.week and e.starts_at < w.week + 7),
    (select count(*) from public.registrations r where r.checked_in_at >= w.week and r.checked_in_at < w.week + 7)
  from w order by w.week;
$$;

select public.enable_audit(t) from unnest(array[
  'public.children','public.child_care','public.guardians','public.child_guardians','public.checkins',
  'public.checklist_templates','public.checklist_template_items','public.checklists','public.checklist_items',
  'public.tasks','public.announcements'
]::regclass[]) t;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.children                 enable row level security;
alter table public.child_care               enable row level security;
alter table public.guardians                enable row level security;
alter table public.child_guardians          enable row level security;
alter table public.checkins                 enable row level security;
alter table public.checklist_templates      enable row level security;
alter table public.checklist_template_items enable row level security;
alter table public.checklists               enable row level security;
alter table public.checklist_items          enable row level security;
alter table public.tasks                    enable row level security;
alter table public.announcements            enable row level security;
alter table public.team_messages            enable row level security;
alter table public.notifications            enable row level security;
alter table public.push_subscriptions       enable row level security;

-- Деца
create policy children_read on public.children for select to authenticated
  using (public.is_kids_staff() or public.is_leadership() or public.is_guardian_of(id));
create policy children_write on public.children for all to authenticated
  using (public.is_kids_staff()) with check (public.is_kids_staff());
create policy child_care_all on public.child_care for all to authenticated
  using (public.can_see_child_care(child_id)) with check (public.can_see_child_care(child_id));
create policy child_care_guardian on public.child_care for select to authenticated
  using (public.is_guardian_of(child_id));
create policy guardians_read on public.guardians for select to authenticated
  using (public.is_kids_staff() or profile_id = auth.uid());
create policy guardians_write on public.guardians for all to authenticated
  using (public.is_kids_staff()) with check (public.is_kids_staff());
create policy child_guardians_read on public.child_guardians for select to authenticated
  using (public.is_kids_staff() or public.is_guardian_of(child_id));
create policy child_guardians_write on public.child_guardians for all to authenticated
  using (public.is_kids_staff()) with check (public.is_kids_staff());
create policy checkins_read on public.checkins for select to authenticated
  using (public.is_kids_staff() or public.is_leadership() or public.is_guardian_of(child_id));
create policy checkins_update on public.checkins for update to authenticated
  using (public.is_department_leader(public.kids_department_id()) or public.is_admin())
  with check (public.is_department_leader(public.kids_department_id()) or public.is_admin());

-- Чеклисти и задачи – по екипи
create policy cl_tpl_read on public.checklist_templates for select to authenticated
  using (public.is_staff() or public.is_team_member(team_id) or public.is_team_leader(team_id));
create policy cl_tpl_write on public.checklist_templates for all to authenticated
  using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id));
create policy cl_tpl_items_read on public.checklist_template_items for select to authenticated
  using (exists (select 1 from public.checklist_templates t where t.id = template_id
                 and (public.is_staff() or public.is_team_member(t.team_id) or public.is_team_leader(t.team_id))));
create policy cl_tpl_items_write on public.checklist_template_items for all to authenticated
  using (exists (select 1 from public.checklist_templates t where t.id = template_id and public.can_manage_team(t.team_id)))
  with check (exists (select 1 from public.checklist_templates t where t.id = template_id and public.can_manage_team(t.team_id)));

create policy cl_read on public.checklists for select to authenticated
  using (public.is_staff() or public.is_team_member(team_id) or public.is_team_leader(team_id) or assignee_id = auth.uid());
create policy cl_write on public.checklists for all to authenticated
  using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id));
create policy cl_items_read on public.checklist_items for select to authenticated
  using (exists (select 1 from public.checklists c where c.id = checklist_id
                 and (public.is_staff() or public.is_team_member(c.team_id) or public.is_team_leader(c.team_id) or c.assignee_id = auth.uid())));
create policy cl_items_update on public.checklist_items for update to authenticated
  using (exists (select 1 from public.checklists c where c.id = checklist_id
                 and (public.can_manage_team(c.team_id) or public.is_team_member(c.team_id) or c.assignee_id = auth.uid())))
  with check (exists (select 1 from public.checklists c where c.id = checklist_id
                 and (public.can_manage_team(c.team_id) or public.is_team_member(c.team_id) or c.assignee_id = auth.uid())));
create policy cl_items_write on public.checklist_items for insert to authenticated
  with check (exists (select 1 from public.checklists c where c.id = checklist_id and public.can_manage_team(c.team_id)));
create policy cl_items_delete on public.checklist_items for delete to authenticated
  using (exists (select 1 from public.checklists c where c.id = checklist_id and public.can_manage_team(c.team_id)));

create policy tasks_read on public.tasks for select to authenticated
  using (public.is_staff() or created_by = auth.uid() or assignee_id = auth.uid()
         or (team_id is not null and (public.is_team_member(team_id) or public.is_team_leader(team_id))));
-- Сигнал за повреда може да подаде всеки активен; обикновени задачи – лидерът
create policy tasks_insert on public.tasks for insert to authenticated
  with check (created_by = auth.uid() and public.is_active_user()
              and (is_issue or (team_id is not null and public.can_manage_team(team_id))));
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_staff() or assignee_id = auth.uid() or (team_id is not null and (public.can_manage_team(team_id) or public.is_team_member(team_id))))
  with check (public.is_staff() or assignee_id = auth.uid() or (team_id is not null and (public.can_manage_team(team_id) or public.is_team_member(team_id))));
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_staff() or (team_id is not null and public.can_manage_team(team_id)));

-- Съобщения
create policy ann_read on public.announcements for select to authenticated
  using (public.is_staff() or author_id = auth.uid() or public.in_audience(audience, audience_id));
create policy ann_insert on public.announcements for insert to authenticated
  with check (author_id = auth.uid() and public.can_announce(audience, audience_id));
create policy ann_update on public.announcements for update to authenticated
  using (author_id = auth.uid() or public.is_admin()) with check (author_id = auth.uid() or public.is_admin());
create policy ann_delete on public.announcements for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

-- Чат по екипи
create policy chat_read on public.team_messages for select to authenticated
  using (public.is_team_member(team_id) or public.is_team_leader(team_id) or public.is_staff());
create policy chat_insert on public.team_messages for insert to authenticated
  with check (author_id = auth.uid() and (public.is_team_member(team_id) or public.is_team_leader(team_id)));
create policy chat_delete on public.team_messages for delete to authenticated
  using (author_id = auth.uid() or public.can_manage_team(team_id));

-- Известия и абонаменти – само собствените
create policy notif_own on public.notifications for select to authenticated using (profile_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy notif_delete on public.notifications for delete to authenticated using (profile_id = auth.uid());
create policy push_own on public.push_subscriptions for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------
-- Известие до лидерите при отказ (в базата, за да не се изпусне)
-- ---------------------------------------------------------------------
create or replace function public.notify_on_decline() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text; ev text; pos text;
begin
  if new.status = 'declined' and old.status <> 'declined' then
    select trim(first_name || ' ' || last_name) into who from public.profiles where id = new.profile_id;
    select title into ev from public.events where id = new.event_id;
    select name into pos from public.positions where id = new.position_id;
    insert into public.notifications (profile_id, title, body, url)
    select distinct l.pid, 'Отказ: ' || who, who || ' не може да служи като „' || pos || '“ на „' || ev || '“'
           || coalesce(' – ' || new.decline_reason, ''), '/events/' || new.event_id
    from (select tm.profile_id as pid from public.team_members tm where tm.team_id = new.team_id and tm.is_leader
          union select dl.profile_id from public.department_leaders dl join public.teams t on t.department_id = dl.department_id
                where t.id = new.team_id) l;
  end if;
  return new;
end $$;
create trigger assignments_notify_decline after update of status on public.assignments
  for each row execute function public.notify_on_decline();

-- ===== supabase/migrations/20260101000005_storage_realtime.sql =====
-- =====================================================================
-- 0005 ФАЙЛОВЕ (Supabase Storage) И REALTIME
-- =====================================================================
-- Кофи:
--   avatars      – публични снимки на профилите, път: {user_id}/файл
--   plan-files   – файлове към плановете, път: {event_id}/{team_id|general}/файл
--   task-photos  – снимки към задачи/чеклисти, път: {team_id|issues}/файл
-- =====================================================================

insert into storage.buckets (id, name, public) values
  ('avatars', 'avatars', true),
  ('plan-files', 'plan-files', false),
  ('task-photos', 'task-photos', false)
on conflict (id) do nothing;

create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars');
create policy avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.storage_team_ok(p_part text, p_manage boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare tid uuid;
begin
  if p_part is null or p_part in ('general', 'issues') then
    return case when p_manage then public.has_permission('events') else public.is_active_user() end;
  end if;
  begin tid := p_part::uuid; exception when others then return false; end;
  if p_manage then return public.can_manage_team(tid); end if;
  return public.is_staff() or public.is_team_member(tid) or public.is_team_leader(tid);
end $$;

create policy plan_files_read on storage.objects for select to authenticated
  using (bucket_id = 'plan-files' and public.can_see_event(((storage.foldername(name))[1])::uuid)
         and public.storage_team_ok((storage.foldername(name))[2], false));
create policy plan_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'plan-files' and public.storage_team_ok((storage.foldername(name))[2], true));
create policy plan_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'plan-files' and public.storage_team_ok((storage.foldername(name))[2], true));

-- Снимки към задачи: качва всеки член на екипа (доказателство) или всеки (сигнал за повреда в „issues“)
create policy task_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'task-photos' and public.storage_team_ok((storage.foldername(name))[1], false));
create policy task_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'task-photos' and public.is_active_user()
              and ((storage.foldername(name))[1] = 'issues' or public.storage_team_ok((storage.foldername(name))[1], false)));

-- Realtime: живо обновяване на графика, чата и известията (RLS важи и тук)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.assignments, public.team_messages, public.notifications;
  end if;
end $$;

-- ===== supabase/migrations/20260101000006_scheduling_helpers.sql =====
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

-- ===== supabase/migrations/20260101000007_note_privacy.sql =====
-- =====================================================================
-- 0007 БЕЛЕЖКИ ЗА ХОРАТА: обикновени и лични (от срещи)
-- =====================================================================
-- Обикновените бележки виждат ръководството и администраторът.
-- Личните бележки от срещи виждат САМО членовете на ръководството.

alter table public.profile_notes add column is_private boolean not null default false;
comment on column public.profile_notes.is_private is 'Лична бележка от среща – вижда се само от ръководството';

drop policy notes_all on public.profile_notes;

create policy notes_select on public.profile_notes for select to authenticated
  using (public.is_leadership() or (public.is_admin() and not is_private));
create policy notes_insert on public.profile_notes for insert to authenticated
  with check (public.is_leadership() or (public.is_admin() and not is_private));
create policy notes_update on public.profile_notes for update to authenticated
  using (public.is_leadership() or (public.is_admin() and not is_private))
  with check (public.is_leadership() or (public.is_admin() and not is_private));
create policy notes_delete on public.profile_notes for delete to authenticated
  using (public.is_leadership() or (public.is_admin() and not is_private));

-- ===== supabase/seed.sql =====
-- =====================================================================
-- SEED: структура на организацията (отдели → екипи → позиции),
-- помещения, примерни чеклисти и седмично събитие.
-- Може да се пуска многократно – ако структурата вече съществува, се пропуска.
-- =====================================================================
do $$
declare
  d uuid; t uuid; s uuid;
  hall uuid; small_hall uuid;

begin
  if exists (select 1 from public.departments) then
    raise notice 'Структурата вече съществува – пропускам.';
    return;
  end if;

  create temp table _p (team uuid, name text, cnt int, sort int) on commit drop;

  -- 1. РЪКОВОДСТВО -----------------------------------------------------
  insert into public.departments (slug, name, color, sort) values ('leadership', 'Ръководство', '#0f172a', 1) returning id into d;
  insert into public.teams (department_id, name, sort, permissions) values (d, 'Основатели', 1, '{events,registrations,rooms,gifts,announcements}') returning id into t;
  insert into _p values (t, 'Основател', 2, 1);
  insert into public.teams (department_id, name, sort, permissions) values (d, 'Ключови роли', 2, '{events,registrations,rooms,gifts,announcements}') returning id into t;
  insert into _p values (t, 'Ключова роля', 6, 1);

  -- 2. ПРОДУКЦИЯ ---------------------------------------------------------
  insert into public.departments (slug, name, color, sort) values ('production', 'Продукция', '#7c3aed', 2) returning id into d;
  insert into public.teams (department_id, name, sort) values (d, 'Видео', 1) returning id into t;
  insert into _p values (t, 'Режисьор', 1, 1), (t, 'Оператор камера', 3, 2);
  insert into public.teams (department_id, name, sort) values (d, 'Фото', 2) returning id into t;
  insert into _p values (t, 'Фотограф', 1, 1);
  insert into public.teams (department_id, name, sort) values (d, 'Осветление', 3) returning id into t;
  insert into _p values (t, 'Осветител', 1, 1);
  insert into public.teams (department_id, name, sort, description) values (d, 'Медия', 4, 'Само хора и задачи – техниката се управлява от отделен софтуер') returning id into t;
  insert into _p values (t, 'Онлайн излъчване', 1, 1), (t, 'LED стена', 1, 2), (t, 'Бекстейдж монитор', 1, 3), (t, 'Текст на стената', 1, 4);
  insert into public.teams (department_id, name, sort) values (d, 'Дизайн и визии', 5) returning id into t;
  insert into _p values (t, 'YouTube тъмнейли', 1, 1), (t, 'LED стена', 1, 2), (t, 'Съобщения', 1, 3), (t, 'Постове', 1, 4);
  insert into public.teams (department_id, name, sort) values (d, 'Превод на живо', 6) returning id into t;
  insert into _p values (t, 'Преводач', 1, 1);

  -- 3. ОНЛАЙН И КОМУНИКАЦИЯ ----------------------------------------------
  insert into public.departments (slug, name, color, sort) values ('online', 'Онлайн и комуникация', '#0ea5e9', 3) returning id into d;
  insert into public.teams (department_id, name, sort) values (d, 'Социални мрежи', 1) returning id into t;
  insert into _p values (t, 'Facebook', 1, 1), (t, 'Instagram', 1, 2), (t, 'YouTube', 1, 3), (t, 'Сторита', 1, 4);
  insert into public.teams (department_id, name, sort) values (d, 'Уебсайт', 2) returning id into t;
  insert into _p values (t, 'Уеб администратор', 1, 1);
  insert into public.teams (department_id, name, sort) values (d, 'Чат при онлайн излъчване', 3) returning id into t;
  insert into _p values (t, 'Модератор на чата', 1, 1);
  insert into public.teams (department_id, name, sort) values (d, 'Маркетинг', 4) returning id into t;
  insert into _p values (t, 'Маркетинг', 1, 1);

  -- 4. ХВАЛЕНИЕ И МОЛИТВА -------------------------------------------------
  insert into public.departments (slug, name, color, sort) values ('worship', 'Хваление и молитва', '#e11d48', 4) returning id into d;
  insert into public.teams (department_id, name, sort) values (d, 'Хваление', 1) returning id into t;
  insert into _p values (t, 'Лидер', 1, 1), (t, 'Вокалист', 3, 2), (t, 'Музикант', 4, 3);
  insert into public.teams (department_id, name, sort) values (d, 'Пост и молитва', 2) returning id into t;
  insert into _p values (t, 'Лидер', 1, 1), (t, 'Участник', 5, 2);

  -- 5. СЪБИТИЯ И ГОСТОПРИЕМСТВО ------------------------------------------
  insert into public.departments (slug, name, color, sort) values ('hospitality', 'Събития и гостоприемство', '#f59e0b', 5) returning id into d;
  insert into public.teams (department_id, name, sort, permissions) values (d, 'Разпоредители', 1, '{registrations}') returning id into t;
  insert into _p values (t, 'Разпоредител', 4, 1);
  insert into public.teams (department_id, name, sort, permissions) values (d, 'Посрещане', 2, '{registrations}') returning id into t;
  insert into _p values (t, 'Посрещач', 3, 1);
  insert into public.teams (department_id, name, sort) values (d, 'Кафене', 3) returning id into t;
  insert into _p values (t, 'Отговорник', 1, 1), (t, 'Доброволец', 3, 2);
  insert into public.teams (department_id, name, sort, permissions) values (d, 'Книжарница', 4, '{gifts}') returning id into t;
  insert into _p values (t, 'Отговорник', 1, 1), (t, 'Доброволец', 2, 2);
  insert into public.teams (department_id, name, sort) values (d, 'Кухня', 5) returning id into t;
  insert into _p values (t, 'Доброволец', 3, 1);

  -- 6. ДЕТСКО СЛУЖЕНИЕ -----------------------------------------------------
  insert into public.departments (slug, name, color, sort) values ('kids', 'Детско служение', '#10b981', 6) returning id into d;
  insert into public.teams (department_id, name, sort, permissions) values (d, 'Ръководство на детското служение', 0, '{checkins}') returning id into t;
  insert into _p values (t, 'Главен лидер', 1, 1);
  insert into public.teams (department_id, name, sort, min_age, max_age) values (d, 'Група 3–4 г.', 1, 3, 4) returning id into t;
  insert into _p values (t, 'Отговорник', 1, 1), (t, 'Учител', 2, 2), (t, 'Помощник-учител', 2, 3);
  insert into public.teams (department_id, name, sort, min_age, max_age) values (d, 'Група 5–6 г.', 2, 5, 6) returning id into t;
  insert into _p values (t, 'Отговорник', 1, 1), (t, 'Учител', 2, 2), (t, 'Помощник-учител', 2, 3);
  insert into public.teams (department_id, name, sort, min_age, max_age) values (d, 'Група 7–8 г.', 3, 7, 8) returning id into t;
  insert into _p values (t, 'Отговорник', 1, 1), (t, 'Учител', 2, 2), (t, 'Помощник-учител', 2, 3);
  insert into public.teams (department_id, name, sort, min_age, max_age) values (d, 'Група 9–10 г.', 4, 9, 10) returning id into t;
  insert into _p values (t, 'Отговорник', 1, 1), (t, 'Учител', 2, 2), (t, 'Помощник-учител', 2, 3);
  insert into public.teams (department_id, name, sort, min_age, max_age) values (d, 'Група 11–12 г.', 5, 11, 12) returning id into t;
  insert into _p values (t, 'Отговорник', 1, 1), (t, 'Учител', 2, 2), (t, 'Помощник-учител', 2, 3);

  -- 7. СГРАДА И ПОДДРЪЖКА --------------------------------------------------
  insert into public.departments (slug, name, color, sort) values ('building', 'Сграда и поддръжка', '#64748b', 7) returning id into d;
  insert into public.teams (department_id, name, sort) values (d, 'Строителство', 1) returning id into t;
  insert into _p values (t, 'Строител', 3, 1);
  insert into public.teams (department_id, name, sort) values (d, 'Почистване', 2) returning id into t;
  insert into _p values (t, 'Доброволец', 4, 1);
  insert into public.checklist_templates (team_id, title, recurrence, weekday, due_time) values (t, 'Почистване след неделното събиране', 'weekly', 7, '16:00') returning id into s;
  insert into public.checklist_template_items (template_id, sort, title, requires_photo) values
    (s, 1, 'Голяма зала – метене и миене', false), (s, 2, 'Тоалетни – почистване и консумативи', true),
    (s, 3, 'Изхвърляне на боклука', false), (s, 4, 'Фоайе и входове', false);
  insert into public.teams (department_id, name, sort) values (d, 'Градина и външни площи', 3) returning id into t;
  insert into _p values (t, 'Доброволец', 2, 1);
  insert into public.checklist_templates (team_id, title, recurrence, weekday, due_time) values (t, 'Седмична поддръжка на двора', 'weekly', 6, '12:00') returning id into s;
  insert into public.checklist_template_items (template_id, sort, title, requires_photo) values
    (s, 1, 'Косене / метене на алеите', false), (s, 2, 'Поливане', false), (s, 3, 'Проверка на осветлението отвън', false);
  insert into public.teams (department_id, name, sort) values (d, 'Поддръжка на сградата', 4) returning id into t;
  insert into _p values (t, 'Техник поддръжка', 1, 1);
  insert into public.checklist_templates (team_id, title, recurrence, month_day, due_time) values (t, 'Месечна проверка на сградата', 'monthly', 1, '18:00') returning id into s;
  insert into public.checklist_template_items (template_id, sort, title, requires_photo) values
    (s, 1, 'Пожарогасители – срок на годност', true), (s, 2, 'Аварийно осветление', false), (s, 3, 'Течове и влага', false);
  insert into public.teams (department_id, name, sort) values (d, 'Отключване и заключване', 5) returning id into t;
  insert into _p values (t, 'Отговорник', 2, 1);
  insert into public.checklist_templates (team_id, title, recurrence, weekday, due_time) values (t, 'Отключване и заключване – неделя', 'weekly', 7, '09:00') returning id into s;
  insert into public.checklist_template_items (template_id, sort, title, requires_photo) values
    (s, 1, 'Отключване на главния вход (09:00)', false), (s, 2, 'Включване на отоплението / климатика', false),
    (s, 3, 'Проверка на прозорците преди заключване', false), (s, 4, 'Изключване на осветлението', false),
    (s, 5, 'Заключване и алармата', true);

  -- чеклисти за кафенето и кухнята
  select id into t from public.teams where name = 'Кафене';
  insert into public.checklist_templates (team_id, title, recurrence, weekday, due_time) values (t, 'Подготовка на кафенето', 'weekly', 7, '10:00') returning id into s;
  insert into public.checklist_template_items (template_id, sort, title) values
    (s, 1, 'Кафемашина – включване и проверка'), (s, 2, 'Чаши, захар, мляко'), (s, 3, 'Каса и ценоразпис'), (s, 4, 'Почистване след затваряне');
  select id into t from public.teams where name = 'Кухня';
  insert into public.checklist_templates (team_id, title, recurrence, weekday, due_time) values (t, 'Подготовка на кухнята', 'weekly', 7, '11:00') returning id into s;
  insert into public.checklist_template_items (template_id, sort, title, requires_photo) values
    (s, 1, 'Хладилник – температура и срокове', true), (s, 2, 'Съдове и прибори', false), (s, 3, 'Почистване на плотовете', false), (s, 4, 'Изхвърляне на храната с изтекъл срок', false);

  insert into public.positions (team_id, name, default_count, sort) select team, name, cnt, sort from _p;

  -- ПОМЕЩЕНИЯ -------------------------------------------------------------
  insert into public.rooms (name, capacity, seat_rows, seats_per_row, sort) values ('Голяма зала', 300, 15, 20, 1) returning id into hall;
  insert into public.rooms (name, capacity, seat_rows, seats_per_row, sort) values ('Малка зала', 60, 6, 10, 2) returning id into small_hall;
  insert into public.rooms (name, capacity, sort) values
    ('Детска стая 1', 20, 3), ('Детска стая 2', 20, 4), ('Детска стая 3', 20, 5),
    ('Кафене', 40, 6), ('Кухня', 8, 7), ('Заседателна зала', 12, 8);

  -- ПРИМЕРНО СЕДМИЧНО СЪБИТИЕ ---------------------------------------------
  insert into public.event_series (title, description, weekday, start_time, duration_minutes, room_id, starts_on)
  values ('Неделно събиране', 'Седмичното събиране в неделя', 7, '10:30', 150, hall, current_date) returning id into s;
  insert into public.series_needs (series_id, position_id, needed)
  select s, p.id, p.default_count from public.positions p join public.teams tm on tm.id = p.team_id
  where tm.name in ('Видео','Фото','Осветление','Медия','Превод на живо','Хваление','Разпоредители','Посрещане','Кафене')
     or tm.name like 'Група%';
  perform public.generate_series_events(s, current_date + 56);

  raise notice 'Структурата е създадена.';
end $$;

-- ---------------------------------------------------------------------
-- ПЪРВИЯТ АДМИНИСТРАТОР
-- След като влезете за първи път в приложението с вашия имейл, пуснете
-- (с вашия имейл):
--
--   update public.profiles set status = 'active', system_role = 'admin'
--   where email = 'vashiat@imeil.bg';
-- ---------------------------------------------------------------------

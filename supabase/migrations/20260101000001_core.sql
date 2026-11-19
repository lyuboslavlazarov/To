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

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

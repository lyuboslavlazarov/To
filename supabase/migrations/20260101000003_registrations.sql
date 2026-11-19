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

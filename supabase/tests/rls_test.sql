-- =====================================================================
-- Автоматични тестове на правата (RLS) и бизнес правилата.
-- Пускат се от supabase/tests/run_local.sh върху празна база.
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create function public.t_login(p uuid, p_aal text default 'aal2') returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false),
         set_config('request.jwt.claims', json_build_object('sub', p, 'aal', p_aal)::text, false);
$$;
create function public.t_assert(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'ТЕСТЪТ СЕ ПРОВАЛИ: %', msg; end if; end $$;
create function public.t_fails(sql text, msg text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then return; end;
  raise exception 'ТЕСТЪТ СЕ ПРОВАЛИ (очаквах грешка): %', msg;
end $$;
grant execute on function public.t_login, public.t_assert, public.t_fails to authenticated, anon;

-- ---------- Подготовка: хора ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.bg', '{"first_name":"Ана","last_name":"Админ"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'lead@test.bg',  '{"first_name":"Борис","last_name":"Ръководител"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'video.lead@test.bg', '{"first_name":"Виктор","last_name":"Видео"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'video@test.bg', '{"first_name":"Георги","last_name":"Камера"}'),
  ('00000000-0000-0000-0000-0000000000d1', 'clean@test.bg', '{"first_name":"Дора","last_name":"Чистота"}'),
  ('00000000-0000-0000-0000-0000000000e1', 'new@test.bg', '{"first_name":"Нов","last_name":"Човек"}'),
  ('00000000-0000-0000-0000-0000000000f1', 'kids34@test.bg', '{"first_name":"Ели","last_name":"Учител"}'),
  ('00000000-0000-0000-0000-0000000000f2', 'kids56@test.bg', '{"first_name":"Жана","last_name":"Учител"}');

select t_assert((select count(*) = 8 from profiles where status = 'pending'), 'всички нови са „чака одобрение“');

update profiles set status = 'active' where email <> 'new@test.bg';
update profiles set system_role = 'admin' where email = 'admin@test.bg';
update profiles set system_role = 'leadership' where email = 'lead@test.bg';

insert into team_members (team_id, profile_id, is_leader)
select t.id, p.id, p.email = 'video.lead@test.bg' from teams t, profiles p
where (t.name = 'Видео' and p.email in ('video.lead@test.bg', 'video@test.bg'))
   or (t.name = 'Фото' and p.email = 'video@test.bg')
   or (t.name = 'Почистване' and p.email = 'clean@test.bg')
   or (t.name = 'Група 3–4 г.' and p.email = 'kids34@test.bg')
   or (t.name = 'Група 5–6 г.' and p.email = 'kids56@test.bg');

insert into profile_notes (profile_id, body) select id, 'Поверителна бележка' from profiles where email = 'video@test.bg';

-- ---------- Чакащ одобрение ----------
set role authenticated;
select t_login('00000000-0000-0000-0000-0000000000e1');
select t_assert((select count(*) = 1 from profiles), 'чакащият вижда само себе си');
select t_assert((select count(*) = 0 from events), 'чакащият не вижда събития');
select t_fails($$update profiles set status = 'active' where id = auth.uid()$$, 'не може сам да се одобри');

-- ---------- Почистване не вижда нищо от Видео ----------
select t_login('00000000-0000-0000-0000-0000000000d1');
select t_assert((select count(*) > 0 from events), 'всички виждат общия календар');
select t_assert((select count(*) = 0 from plan_needs n join teams t on t.id = n.team_id where t.name = 'Видео'), 'Почистване не вижда нуждите на Видео');
select t_assert((select count(*) = 0 from profiles where email like 'video%'), 'Почистване не вижда хората от Видео');
select t_assert((select count(*) = 0 from profile_notes), 'обикновен член не вижда бележки');
select t_fails($$insert into team_messages (team_id, author_id, body) select id, auth.uid(), 'хак' from teams where name = 'Видео'$$, 'не пише в чужд чат');
select t_fails($$update profiles set system_role = 'admin' where id = auth.uid()$$, 'не може да си даде роля');

-- ---------- Лидерът на Видео разпределя ----------
select t_login('00000000-0000-0000-0000-0000000000c1');
insert into assignments (event_id, position_id, profile_id, assigned_by)
select e.id, p.id, '00000000-0000-0000-0000-0000000000c2', auth.uid()
from (select id from events order by starts_at limit 1) e, positions p join teams t on t.id = p.team_id
where t.name = 'Видео' and p.name = 'Оператор камера';
select t_assert((select count(*) = 1 from assignments), 'лидерът създаде покана');
select t_fails($$insert into assignments (event_id, position_id, profile_id)
  select e.id, p.id, '00000000-0000-0000-0000-0000000000c2'
  from (select id from events order by starts_at limit 1) e, positions p join teams t on t.id = p.team_id where t.name = 'Фото'$$,
  'лидерът на Видео не може да пише във Фото');
select t_assert((select count(*) = 0 from profile_notes), 'лидерът не вижда бележки');

-- ---------- Конфликт: същото лице, друг екип, същото време ----------
reset role; select t_login(null);
update team_members set is_leader = true where profile_id = '00000000-0000-0000-0000-0000000000c1';
insert into team_members (team_id, profile_id, is_leader) select id, '00000000-0000-0000-0000-0000000000c1', true from teams where name = 'Фото';
set role authenticated;
select t_login('00000000-0000-0000-0000-0000000000c1');
select t_fails($$insert into assignments (event_id, position_id, profile_id)
  select e.id, p.id, '00000000-0000-0000-0000-0000000000c2'
  from (select id from events order by starts_at limit 1) e, positions p join teams t on t.id = p.team_id where t.name = 'Фото'$$,
  'конфликт: един човек на две места по едно и също време');
select t_assert((select count(*) >= 1 from person_busy('00000000-0000-0000-0000-0000000000c2', (select id from events order by starts_at limit 1))), 'лидерът вижда къде е зает човекът');

-- ---------- Доброволецът отговаря ----------
select t_login('00000000-0000-0000-0000-0000000000c2');
select t_fails($$update assignments set position_id = (select id from positions where name = 'Режисьор') where profile_id = auth.uid()$$, 'доброволецът не сменя позицията');
update assignments set status = 'declined', decline_reason = 'болен' where profile_id = auth.uid();
select t_assert((select status = 'declined' from assignments where profile_id = auth.uid()), 'доброволецът отказа');
select t_login('00000000-0000-0000-0000-0000000000c1');
select t_assert((select count(*) = 1 from notifications where title like 'Отказ%'), 'лидерът получи известие за отказа');

-- Блокиране („Не мога“ и отсъствие)
select t_login('00000000-0000-0000-0000-0000000000c2');
insert into availability (profile_id, event_id, team_id, status)
select auth.uid(), id, null, 'unavailable' from events order by starts_at offset 1 limit 1;
select t_fails($$insert into availability (profile_id, event_id, team_id, status) select auth.uid(), e.id, t.id, 'available' from events e, teams t where t.name = 'Почистване' limit 1$$, 'не може да се отбележи в чужд екип');
select t_login('00000000-0000-0000-0000-0000000000c1');
select t_fails($$insert into assignments (event_id, position_id, profile_id)
  select e.id, p.id, '00000000-0000-0000-0000-0000000000c2'
  from (select id from events order by starts_at offset 1 limit 1) e, positions p join teams t on t.id = p.team_id where t.name = 'Видео' and p.name = 'Режисьор'$$,
  'не се записва човек, отбелязал „Не мога“');

-- ---------- 2FA за администратора ----------
select t_login('00000000-0000-0000-0000-0000000000a1', 'aal1');
select t_assert(not is_admin(), 'админ без 2FA няма админ права');
select t_login('00000000-0000-0000-0000-0000000000a1', 'aal2');
select t_assert(is_admin(), 'админ с 2FA има права');
select t_assert((select count(*) = 0 from profile_notes), 'бележките са само за ръководството (не и за админа)');
select t_assert((select count(*) > 0 from audit_log), 'админът вижда одитния журнал');

select t_login('00000000-0000-0000-0000-0000000000b1');
select t_assert((select count(*) = 1 from profile_notes), 'ръководството вижда бележките');
select t_assert((select count(*) = 0 from audit_log), 'ръководството не вижда одита');

-- ---------- Помещения без конфликти ----------
select t_fails($$insert into room_bookings (room_id, title, starts_at, ends_at, booked_by)
  select b.room_id, 'Застъпване', b.starts_at + interval '10 min', b.ends_at, auth.uid() from room_bookings b limit 1$$, 'двойна резервация на зала');

-- ---------- Регистрации: капацитет, изчакване, места ----------
reset role; select t_login(null);
insert into reg_events (slug, title, capacity, is_published, use_seating, seat_rows, seats_per_row)
values ('konferencia', 'Конференция', 2, true, true, 2, 2);
set role anon;
select t_login(null);
select t_assert((public_register('konferencia', 'А', 'А', 'a@x.bg', null, '{}', 1, 1) ->> 'status') = 'confirmed', 'първи – потвърден');
select t_fails($$select public_register('konferencia', 'Б', 'Б', 'b@x.bg', null, '{}', 1, 1)$$, 'едно място не може да се заеме два пъти');
select t_fails($$select public_register('konferencia', 'А', 'А', 'A@x.bg', null, '{}', 1, 2)$$, 'един имейл – една регистрация');
select t_assert((public_register('konferencia', 'Б', 'Б', 'b@x.bg', null, '{}', 1, 2) ->> 'status') = 'confirmed', 'втори – потвърден');
select t_assert((public_register('konferencia', 'В', 'В', 'v@x.bg', null, '{}', null, null) ->> 'status') = 'waitlist', 'трети – в изчакване');
select t_assert((select count(*) = 0 from registrations), 'анонимните не виждат регистрациите');
reset role; select t_login(null);
select t_assert((select public_cancel_registration(cancel_token) ->> 'promoted' is not null from registrations where email = 'a@x.bg'), 'при отказ първият чакащ получава мястото');
select t_assert((select status = 'confirmed' and seat_row = 1 and seat_number = 1 from registrations where email = 'v@x.bg'), 'повишеният получава освободеното място');

-- ---------- Деца: бележки само за учителите на групата ----------
insert into children (first_name, last_name, birthdate) values ('Мими', 'Детева', current_date - interval '3 years 6 months');
insert into child_care (child_id, allergies) select id, 'фъстъци' from children;
set role authenticated;
select t_login('00000000-0000-0000-0000-0000000000f1');
select t_assert((select count(*) = 1 from children c join teams t on t.id = c.group_team_id where t.name = 'Група 3–4 г.'), 'детето е в група по възраст');
select t_assert((select count(*) = 1 from child_care), 'учителят на групата вижда алергиите');
select t_assert((kids_check_in((select id from children)) ->> 'code') is not null, 'регистриране с код');
select t_assert((kids_check_out((select id from checkins), 'XXXX') ->> 'ok')::boolean = false, 'грешен код не предава детето');
select t_assert((kids_check_out((select id from checkins), (select security_code from checkins)) ->> 'ok')::boolean, 'правилен код предава детето');
select t_login('00000000-0000-0000-0000-0000000000f2');
select t_assert((select count(*) = 1 from children), 'друг детски учител вижда детето (вход)');
select t_assert((select count(*) = 0 from child_care), 'учител от друга група НЕ вижда алергиите');
select t_login('00000000-0000-0000-0000-0000000000d1');
select t_assert((select count(*) = 0 from children), 'Почистване не вижда децата');
select t_login('00000000-0000-0000-0000-0000000000b1');
select t_assert((select count(*) = 0 from child_care), 'дори ръководството не вижда медицинските бележки');

-- ---------- Задачи и съобщения ----------
select t_login('00000000-0000-0000-0000-0000000000d1');
insert into tasks (title, is_issue, created_by) values ('Счупена брава', true, auth.uid());
select t_fails($$insert into tasks (title, team_id, created_by) select 'х', id, auth.uid() from teams where name = 'Видео'$$, 'член не създава задачи на чужд екип');
select t_fails($$insert into announcements (title, body, audience, author_id) values ('x', 'y', 'all', auth.uid())$$, 'член не праща съобщение до всички');
select t_login('00000000-0000-0000-0000-0000000000c1');
insert into announcements (title, body, audience, audience_id, author_id) select 'Видео', 'Среща', 'team', id, auth.uid() from teams where name = 'Видео';
select t_login('00000000-0000-0000-0000-0000000000d1');
select t_assert((select count(*) = 0 from announcements), 'Почистване не вижда съобщенията на Видео');
select t_login('00000000-0000-0000-0000-0000000000c2');
select t_assert((select count(*) = 1 from announcements), 'член на Видео вижда съобщението');

-- ---------- Чеклисти ----------
reset role; select t_login(null);
select t_assert(generate_due_checklists(14) > 0, 'генериране на чеклисти');

reset role; select t_login(null);

-- ---------- Кандидати за позиция (лидер) ----------
set role authenticated;
select t_login('00000000-0000-0000-0000-0000000000c1');
select t_assert((select count(*) >= 2 from event_team_candidates((select id from events order by starts_at limit 1), (select id from teams where name = 'Видео'))), 'лидерът вижда кандидатите');
select t_login('00000000-0000-0000-0000-0000000000d1');
select t_assert((select count(*) = 0 from event_team_candidates((select id from events order by starts_at limit 1), (select id from teams where name = 'Видео'))), 'чужд не вижда кандидатите на Видео');
reset role; select t_login(null);
select 'ВСИЧКИ ТЕСТОВЕ МИНАХА ✔' as result;

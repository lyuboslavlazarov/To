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

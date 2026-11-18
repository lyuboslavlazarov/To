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

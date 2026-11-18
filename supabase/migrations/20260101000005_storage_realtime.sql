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

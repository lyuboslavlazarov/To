-- =====================================================================
-- 0008 ЗАТЯГАНЕ НА СИГУРНОСТТА (по препоръките на Supabase Security Advisor)
-- =====================================================================
-- Генерирането на чеклисти се вика само от ежедневната задача (service role)
revoke execute on function public.generate_due_checklists(int) from authenticated, anon, public;

-- Фиксиран search_path за тригерните функции
alter function public.touch_updated_at() set search_path = '';
alter function public.enable_audit(regclass) set search_path = public;
alter function public.room_booking_friendly_error() set search_path = '';
alter function public.checklist_item_guard() set search_path = '';

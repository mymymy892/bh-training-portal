-- Permanent change log: written by the database itself, readable only by leadership, never editable
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_name text,
  tbl text not null,
  op text not null,
  row_key text,
  old_row jsonb,
  new_row jsonb,
  changed text[]
);
create index if not exists audit_log_at on public.audit_log(at desc);
create index if not exists audit_log_actor on public.audit_log(actor, at desc);
alter table public.audit_log enable row level security;
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select using (public.my_role() = 'leadership');
revoke insert, update, delete, truncate on public.audit_log from public, anon, authenticated;

create or replace function public.audit_log_locked() returns trigger language plpgsql as $$
begin raise exception 'The change log cannot be edited or deleted'; end $$;
drop trigger if exists audit_log_locked on public.audit_log;
create trigger audit_log_locked before update or delete on public.audit_log for each row execute function public.audit_log_locked();
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate before truncate on public.audit_log for each statement execute function public.audit_log_locked();

create or replace function public.audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb; ch text[]; k text; who uuid := auth.uid(); nm text; ignore text[] := coalesce(tg_argv, '{}'::text[]);
begin
  begin
    if tg_op = 'DELETE' then o := to_jsonb(old); elsif tg_op = 'INSERT' then n := to_jsonb(new); else o := to_jsonb(old); n := to_jsonb(new); end if;
    if tg_op = 'UPDATE' then
      select array_agg(key order by key) into ch from jsonb_each(n) e
       where (o->e.key) is distinct from e.value and not (e.key = any(ignore || array['updated_at']));
      if ch is null then return null; end if;   -- nothing meaningful changed
    end if;
    -- training progress: only log when someone other than the caregiver changes it
    if tg_table_name = 'course_progress' and who is not null and who::text = coalesce(n->>'user_id', o->>'user_id') then return null; end if;
    k := coalesce(n->>'id', o->>'id', n->>'email', o->>'email');
    if who is not null then select full_name into nm from public.profiles where id = who; end if;
    insert into public.audit_log(actor, actor_name, tbl, op, row_key, old_row, new_row, changed)
    values (who, coalesce(nm, case when who is null then 'System' end), tg_table_name, lower(tg_op), k, o, n, ch);
  exception when others then raise warning 'audit_row failed on %: %', tg_table_name, sqlerrm;
  end;
  return null;
end $$;
revoke execute on function public.audit_row() from public, anon, authenticated;

do $$ declare t text; a text; begin
  for t, a in select * from (values
    ('approved_people',''), ('completions',''), ('legacy_training',''), ('home_events',''), ('homes',''),
    ('profiles',''), ('reminder_settings',''), ('portal_settings',''), ('bh_sites',''), ('cert_assets',''),
    ('caregiver_questions','''alerted_at'',''attempts'',''last_error'''), ('course_progress','')) v(t,a)
  loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists zz_audit on public.%I', t);
      execute format('create trigger zz_audit after insert or update or delete on public.%I for each row execute function public.audit_row(%s)', t, a);
    end if;
  end loop;
end $$;

-- time in the Staff Dashboard
create table if not exists public.portal_sessions (
  id uuid primary key,
  user_id uuid not null,
  started_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  active_seconds int not null default 0,
  last_page text
);
create index if not exists portal_sessions_user on public.portal_sessions(user_id, started_at desc);
alter table public.portal_sessions enable row level security;
drop policy if exists portal_sessions_read on public.portal_sessions;
create policy portal_sessions_read on public.portal_sessions for select using (public.my_role() = 'leadership');
revoke insert, update, delete, truncate on public.portal_sessions from public, anon, authenticated;

create or replace function public.portal_heartbeat(p_session uuid, p_page text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare s record; add int := 0;
begin
  if auth.uid() is null or p_session is null then return; end if;
  select * into s from public.portal_sessions where id = p_session;
  if not found then
    insert into public.portal_sessions(id, user_id, last_page) values (p_session, auth.uid(), left(p_page, 80)) on conflict do nothing;
    return;
  end if;
  if s.user_id <> auth.uid() then return; end if;
  if p_active then add := least(greatest(extract(epoch from now() - s.last_seen)::int, 0), 180); end if;
  update public.portal_sessions set last_seen = now(), active_seconds = active_seconds + add, last_page = left(coalesce(p_page, last_page), 80) where id = p_session;
end $$;
revoke execute on function public.portal_heartbeat(uuid, text, boolean) from public, anon;
grant execute on function public.portal_heartbeat(uuid, text, boolean) to authenticated;

-- Activity page feed (leadership only)
create or replace function public.staff_activity(p_from timestamptz, p_to timestamptz, p_actor uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role() <> 'leadership' then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'changes', coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc) from (select * from public.audit_log where at >= p_from and at < p_to and (p_actor is null or actor = p_actor) order by at desc limit 2000) a), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'actor', l.actor, 'action', l.action, 'target', l.target) order by l.at desc) from (select * from public.access_log where at >= p_from and at < p_to and (p_actor is null or actor = p_actor) order by at desc limit 3000) l), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(to_jsonb(s) order by s.started_at desc) from (select * from public.portal_sessions where started_at < p_to and last_seen >= p_from and (p_actor is null or user_id = p_actor) order by started_at desc limit 1000) s), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'home', p.home_label, 'role', p.role)) from public.profiles p), '[]'::jsonb)
  );
end $$;
revoke execute on function public.staff_activity(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.staff_activity(timestamptz, timestamptz, uuid) to authenticated;

select 'ok'::text;

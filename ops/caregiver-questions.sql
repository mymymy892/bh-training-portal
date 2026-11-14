create table if not exists public.caregiver_questions (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  course_code text not null,
  scene text not null,
  question text not null,
  qhash text generated always as (md5(question)) stored,
  asked_at timestamptz not null default now(),
  alerted_at timestamptz,
  answered_at timestamptz,
  answered_by uuid,
  answer_note text,
  unique (user_id, course_code, scene, qhash)
);
alter table public.caregiver_questions enable row level security;
drop policy if exists caregiver_questions_read on public.caregiver_questions;
create policy caregiver_questions_read on public.caregiver_questions for select using (public.has_perm('view_training') or public.has_perm('manage_families'));

create or replace function public.capture_questions(p_user uuid, p_course text, p_reflect jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; q text;
begin
  if p_user is null or p_reflect is null or jsonb_typeof(p_reflect) <> 'object' then return; end if;
  for k, v in select * from jsonb_each(p_reflect) loop
    if jsonb_typeof(v) = 'object' and v ? 'questions' then
      q := btrim(coalesce(v->>'questions',''));
      if length(q) >= 2 and q !~* '^[[:space:][:punct:]]*(n/?a|none|no|nope|nothing|not at this time|no questions?|not right now|not yet|none at this time|nothing at this time)([[:space:][:punct:]]+(at this time|right now|for now|at the moment|yet|thank you|thanks|thank u|ty))*[[:space:][:punct:]]*$' then
        insert into public.caregiver_questions(user_id, course_code, scene, question) values (p_user, p_course, k, left(q, 2000))
        on conflict (user_id, course_code, scene, qhash) do nothing;
      end if;
    end if;
  end loop;
end $$;

create or replace function public.questions_from_progress() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.capture_questions(new.user_id, new.course_code, new.state->'reflect'); return null; end $$;
drop trigger if exists questions_from_progress on public.course_progress;
create trigger questions_from_progress after insert or update on public.course_progress for each row execute function public.questions_from_progress();

create or replace function public.questions_from_completion() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.capture_questions(new.user_id, new.course_code, new.answers->'reflect'); return null; end $$;
drop trigger if exists questions_from_completion on public.completions;
create trigger questions_from_completion after insert on public.completions for each row execute function public.questions_from_completion();

create or replace function public.answer_question(p_id bigint, p_note text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not (public.has_perm('view_training') or public.has_perm('manage_families')) then raise exception 'Not allowed'; end if;
  update public.caregiver_questions set answered_at = now(), answered_by = auth.uid(), answer_note = nullif(btrim(coalesce(p_note,'')),'')
   where id = p_id and answered_at is null;
  get diagnostics n = row_count; return n;
end $$;
grant execute on function public.answer_question(bigint, text) to authenticated;
create or replace function public.reopen_question(p_id bigint)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not (public.has_perm('view_training') or public.has_perm('manage_families')) then raise exception 'Not allowed'; end if;
  update public.caregiver_questions set answered_at = null, answered_by = null, answer_note = null where id = p_id;
  get diagnostics n = row_count; return n;
end $$;
grant execute on function public.reopen_question(bigint) to authenticated;

-- existing questions: capture them now, without sending alert emails for questions already asked
select public.capture_questions(user_id, course_code, state->'reflect') from public.course_progress;
select public.capture_questions(user_id, course_code, answers->'reflect') from public.completions where not coalesce(voided,false);
update public.caregiver_questions set alerted_at = now() where alerted_at is null;

do $$ declare c text; begin select conname into c from pg_constraint where conrelid='public.reminder_log'::regclass and contype='c'; execute format('alter table public.reminder_log drop constraint %I', c); end $$;
alter table public.reminder_log add constraint reminder_log_kind_check check (kind in ('family','staff','sample','run','cpr','six','question'));

select json_agg(json_build_object('p',p.full_name,'c',q.course_code,'s',q.scene,'q',left(q.question,80)))::text from public.caregiver_questions q left join public.profiles p on p.id=q.user_id;

-- alerts: pg_cron job 'caregiver-question-alerts' runs every 10 minutes, calling training-reminders?mode=questions with the same headers as training-reminders-am

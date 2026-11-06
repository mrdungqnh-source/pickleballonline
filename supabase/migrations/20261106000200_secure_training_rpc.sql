begin;

create table public.training_daily_limits (
  user_id uuid not null references public.profiles (id) on delete cascade,
  training_day date not null,
  sessions integer not null default 0 check (sessions >= 0),
  primary key (user_id, training_day)
);

create table public.training_sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  exp_awarded integer not null check (exp_awarded > 0),
  levels_gained integer not null default 0 check (levels_gained >= 0),
  completed_at timestamptz not null default now()
);

create index training_sessions_user_completed_idx
  on public.training_sessions (user_id, completed_at desc);

alter table public.training_daily_limits enable row level security;
alter table public.training_sessions enable row level security;

create policy training_sessions_select_own on public.training_sessions
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.training_daily_limits, public.training_sessions from anon, authenticated;
grant select on public.training_sessions to authenticated;
grant all on public.training_daily_limits, public.training_sessions to service_role;

insert into public.system_configs (config_key, config_value, is_public)
values (
  'progression',
  '{"base_exp":100,"difficulty":1.5,"skill_points_per_level":1,"body_points_per_level":1,"training_exp":35,"max_daily_training_sessions":5}',
  true
)
on conflict (config_key) do update
set config_value = public.system_configs.config_value || excluded.config_value,
    updated_at = now();

create or replace function public.complete_training()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_config jsonb;
  v_today date := (now() at time zone 'utc')::date;
  v_exp_award integer;
  v_daily_limit integer;
  v_sessions_today integer;
  v_base_exp numeric;
  v_difficulty numeric;
  v_skill_points_per_level integer;
  v_body_points_per_level integer;
  v_level integer;
  v_exp bigint;
  v_skill_points integer;
  v_body_points integer;
  v_levels_gained integer := 0;
  v_exp_required bigint;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;

  select config_value into v_config
  from public.system_configs
  where config_key = 'progression';

  v_exp_award := coalesce((v_config ->> 'training_exp')::integer, 35);
  v_daily_limit := coalesce((v_config ->> 'max_daily_training_sessions')::integer, 5);
  v_base_exp := coalesce((v_config ->> 'base_exp')::numeric, 100);
  v_difficulty := coalesce((v_config ->> 'difficulty')::numeric, 1.5);
  v_skill_points_per_level := coalesce((v_config ->> 'skill_points_per_level')::integer, 1);
  v_body_points_per_level := coalesce((v_config ->> 'body_points_per_level')::integer, 1);

  if v_exp_award < 1 or v_daily_limit < 1 or v_base_exp < 1 or v_difficulty <= 0 then
    raise exception using errcode = '22023', message = 'Invalid progression configuration.';
  end if;

  insert into public.training_daily_limits (user_id, training_day, sessions)
  values (v_user_id, v_today, 1)
  on conflict (user_id, training_day) do update
  set sessions = public.training_daily_limits.sessions + 1
  where public.training_daily_limits.sessions < v_daily_limit
  returning sessions into v_sessions_today;

  if not found then
    raise exception using errcode = 'P0001', message = 'Daily training limit reached.';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Player profile not found.';
  end if;

  v_level := v_profile.level;
  v_exp := v_profile.current_exp + v_exp_award;
  v_skill_points := v_profile.unspent_skill_points;
  v_body_points := v_profile.unspent_body_points;

  loop
    exit when v_level >= 9999;
    v_exp_required := greatest(1, floor(v_base_exp * power(v_level::numeric, v_difficulty)))::bigint;
    exit when v_exp < v_exp_required;

    v_exp := v_exp - v_exp_required;
    v_level := v_level + 1;
    v_levels_gained := v_levels_gained + 1;
    v_skill_points := v_skill_points + v_skill_points_per_level;
    v_body_points := v_body_points + v_body_points_per_level;
  end loop;

  v_exp_required := greatest(1, floor(v_base_exp * power(v_level::numeric, v_difficulty)))::bigint;

  update public.profiles
  set level = v_level,
      current_exp = v_exp,
      unspent_skill_points = v_skill_points,
      unspent_body_points = v_body_points,
      updated_at = now()
  where id = v_user_id;

  insert into public.training_sessions (user_id, exp_awarded, levels_gained)
  values (v_user_id, v_exp_award, v_levels_gained);

  return jsonb_build_object(
    'exp_awarded', v_exp_award,
    'level', v_level,
    'current_exp', v_exp,
    'exp_required', v_exp_required,
    'levels_gained', v_levels_gained,
    'unspent_skill_points', v_skill_points,
    'unspent_body_points', v_body_points,
    'sessions_today', v_sessions_today,
    'daily_limit', v_daily_limit
  );
end;
$$;

revoke all on function public.complete_training() from public, anon;
grant execute on function public.complete_training() to authenticated;

commit;
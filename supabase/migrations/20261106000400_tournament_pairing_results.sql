begin;

alter table public.matches
  add column if not exists combat_power_a numeric(12,2),
  add column if not exists combat_power_b numeric(12,2),
  add column if not exists rolled_power_a numeric(12,2),
  add column if not exists rolled_power_b numeric(12,2);

insert into public.system_configs (config_key, config_value, is_public)
values (
  'tournament_rewards',
  '{"champion":{"skill_points":3,"body_points":3,"reward_points":500},"runner_up":{"skill_points":2,"body_points":2,"reward_points":250}}',
  true
)
on conflict (config_key) do update
set config_value = public.system_configs.config_value || excluded.config_value,
    updated_at = now();

create or replace function public.player_combat_power(p_user_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_score numeric;
  v_fatigue_config jsonb;
  v_recovery_hours integer;
begin
  select config_value into v_fatigue_config
  from public.system_configs
  where config_key = 'fatigue';
  v_recovery_hours := coalesce((v_fatigue_config ->> 'recovery_hours')::integer, 4);

  select
    greatest(0::numeric, cs.stamina::numeric - fatigue.value)
    + greatest(0::numeric, cs.flexibility::numeric - fatigue.value)
    + greatest(0::numeric, cs.agility::numeric - fatigue.value)
    + coalesce((
      select sum(
        case
          when skill.key in ('flick', 'roll', 'volley', 'lob', 'drip', 'atp') then skill.value::numeric * 1.2
          else skill.value::numeric
        end
      )
      from jsonb_each_text(cs.skills) as skill(key, value)
    ), 0)
    + coalesce((
      select sum(buff.value::numeric)
      from unnest(array[
        cs.equipped_racket_id,
        cs.equipped_shirt_id,
        cs.equipped_pants_id,
        cs.equipped_shoes_id,
        cs.equipped_hat_id,
        cs.equipped_glasses_id
      ]) as equipped(item_id)
      join public.items as item on item.id = equipped.item_id
      cross join lateral jsonb_each_text(item.buffs) as buff(key, value)
    ), 0)
  into v_score
  from public.character_stats as cs
  cross join lateral (
    select case
      when cs.last_match_at is null
        or cs.last_match_at <= now() - make_interval(hours => v_recovery_hours)
      then 0::numeric
      else cs.fatigue_penalty
    end as value
  ) as fatigue
  where cs.user_id = p_user_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Character stats not found.';
  end if;

  return round(v_score, 2);
end;
$$;

revoke all on function public.player_combat_power(uuid) from public, anon, authenticated;

create or replace function public.start_random_tournament(p_tournament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_players uuid[];
  v_teams uuid[] := array[]::uuid[];
  v_player_a uuid;
  v_player_b uuid;
  v_team_id uuid;
  v_remaining integer;
  v_index integer;
  v_match_number integer;
  v_match_count integer;
  v_round_number integer := 1;
begin
  select * into v_tournament
  from public.tournaments
  where id = p_tournament_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Tournament not found.';
  end if;
  if v_tournament.status <> 'open' or v_tournament.matching_type <> 'random' then
    raise exception using errcode = 'P0001', message = 'Tournament cannot be started.';
  end if;
  if v_tournament.max_pairs < 2 then
    raise exception using errcode = '22023', message = 'Tournament needs at least two pairs.';
  end if;

  v_remaining := v_tournament.max_pairs;
  while v_remaining > 1 loop
    if mod(v_remaining, 2) <> 0 then
      raise exception using errcode = '22023', message = 'Pair capacity must be a power of two.';
    end if;
    v_remaining := v_remaining / 2;
  end loop;

  select array_agg(entry.user_id order by random()) into v_players
  from public.tournament_entries as entry
  where entry.tournament_id = p_tournament_id
    and entry.status = 'registered';

  if coalesce(cardinality(v_players), 0) <> v_tournament.max_pairs * 2 then
    raise exception using errcode = 'P0001', message = 'Tournament is not full yet.';
  end if;

  for v_index in 1..v_tournament.max_pairs loop
    v_player_a := v_players[(v_index * 2) - 1];
    v_player_b := v_players[v_index * 2];

    insert into public.tournament_teams (tournament_id, player_a_id, player_b_id, seed)
    values (p_tournament_id, v_player_a, v_player_b, v_index)
    returning id into v_team_id;
    v_teams := array_append(v_teams, v_team_id);

    update public.tournament_entries
    set status = 'paired'
    where tournament_id = p_tournament_id
      and user_id in (v_player_a, v_player_b);
  end loop;

  v_match_count := v_tournament.max_pairs / 2;
  loop
    for v_match_number in 1..v_match_count loop
      if v_round_number = 1 then
        insert into public.matches (tournament_id, round_number, match_number, team_a_id, team_b_id, scheduled_at)
        values (
          p_tournament_id,
          v_round_number,
          v_match_number,
          v_teams[(v_match_number * 2) - 1],
          v_teams[v_match_number * 2],
          v_tournament.starts_at
        );
      else
        insert into public.matches (tournament_id, round_number, match_number, scheduled_at)
        values (p_tournament_id, v_round_number, v_match_number, v_tournament.starts_at);
      end if;
    end loop;

    exit when v_match_count = 1;
    v_match_count := v_match_count / 2;
    v_round_number := v_round_number + 1;
  end loop;

  update public.tournaments
  set status = 'in_progress'
  where id = p_tournament_id;

  return jsonb_build_object(
    'tournament_id', p_tournament_id,
    'status', 'in_progress',
    'pairs', v_tournament.max_pairs,
    'rounds', v_round_number
  );
end;
$$;

revoke all on function public.start_random_tournament(uuid) from public, anon, authenticated;

create or replace function public.register_for_tournament(p_tournament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tournament public.tournaments%rowtype;
  v_level integer;
  v_entries_count integer;
  v_entry_id uuid;
  v_existing_status text;
  v_tournament_status text := 'open';
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;

  select * into v_tournament
  from public.tournaments
  where id = p_tournament_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Tournament not found.';
  end if;
  if v_tournament.status <> 'open' then
    raise exception using errcode = 'P0001', message = 'Tournament registration is closed.';
  end if;
  if v_tournament.matching_type <> 'random' then
    raise exception using errcode = 'P0001', message = 'This tournament requires a confirmed partner.';
  end if;

  select level into v_level from public.profiles where id = v_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Player profile not found.';
  end if;
  if v_level < v_tournament.level_bracket then
    raise exception using errcode = 'P0001', message = 'Player level is below this tournament bracket.';
  end if;

  select id, status into v_entry_id, v_existing_status
  from public.tournament_entries
  where tournament_id = p_tournament_id and user_id = v_user_id
  for update;

  if found and v_existing_status <> 'withdrawn' then
    raise exception using errcode = '23505', message = 'Already registered for this tournament.';
  end if;

  select count(*) into v_entries_count
  from public.tournament_entries
  where tournament_id = p_tournament_id
    and status in ('registered', 'confirmed', 'paired');

  if v_entries_count >= v_tournament.max_pairs * 2 then
    raise exception using errcode = 'P0001', message = 'Tournament registration is full.';
  end if;

  if v_existing_status = 'withdrawn' then
    update public.tournament_entries
    set status = 'registered', invited_partner_id = null, created_at = now()
    where id = v_entry_id;
  else
    insert into public.tournament_entries (tournament_id, user_id, status)
    values (p_tournament_id, v_user_id, 'registered')
    returning id into v_entry_id;
  end if;
  v_entries_count := v_entries_count + 1;

  if v_entries_count = v_tournament.max_pairs * 2 then
    perform public.start_random_tournament(p_tournament_id);
    v_tournament_status := 'in_progress';
  end if;

  return jsonb_build_object(
    'entry_id', v_entry_id,
    'tournament_id', p_tournament_id,
    'status', v_tournament_status,
    'entries_count', v_entries_count,
    'max_players', v_tournament.max_pairs * 2
  );
end;
$$;

revoke all on function public.register_for_tournament(uuid) from public, anon;
grant execute on function public.register_for_tournament(uuid) to authenticated;

create or replace function public.resolve_tournament_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_match public.matches%rowtype;
  v_tournament public.tournaments%rowtype;
  v_team_a public.tournament_teams%rowtype;
  v_team_b public.tournament_teams%rowtype;
  v_config jsonb;
  v_rewards jsonb;
  v_fatigue_increase numeric;
  v_cp_a numeric;
  v_cp_b numeric;
  v_roll_a numeric;
  v_roll_b numeric;
  v_winner uuid;
  v_loser uuid;
  v_final_round integer := 1;
  v_team_count integer;
  v_next_match_number integer;
  v_advanced boolean := false;
  v_player_id uuid;
  v_champion_skill integer;
  v_champion_body integer;
  v_champion_points bigint;
  v_runner_skill integer;
  v_runner_body integer;
  v_runner_points bigint;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Match not found.';
  end if;
  if v_match.winner_team_id is not null then
    raise exception using errcode = '23505', message = 'Match has already been resolved.';
  end if;
  if v_match.team_a_id is null or v_match.team_b_id is null then
    raise exception using errcode = 'P0001', message = 'Match is waiting for its teams.';
  end if;

  select * into v_tournament from public.tournaments where id = v_match.tournament_id;
  if v_tournament.status <> 'in_progress' then
    raise exception using errcode = 'P0001', message = 'Tournament is not in progress.';
  end if;
  if v_match.scheduled_at is not null and now() < v_match.scheduled_at then
    raise exception using errcode = 'P0001', message = 'Match has not started yet.';
  end if;

  select * into v_team_a from public.tournament_teams where id = v_match.team_a_id;
  select * into v_team_b from public.tournament_teams where id = v_match.team_b_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Match team not found.';
  end if;
  if not exists (
    select 1
    from public.tournament_teams as team
    where team.id in (v_match.team_a_id, v_match.team_b_id)
      and v_user_id in (team.player_a_id, team.player_b_id)
  ) then
    raise exception using errcode = '42501', message = 'Only players in this match can resolve it.';
  end if;

  v_cp_a := public.player_combat_power(v_team_a.player_a_id) + public.player_combat_power(v_team_a.player_b_id);
  v_cp_b := public.player_combat_power(v_team_b.player_a_id) + public.player_combat_power(v_team_b.player_b_id);
  v_roll_a := round(v_cp_a * (0.95 + random() * 0.10), 2);
  v_roll_b := round(v_cp_b * (0.95 + random() * 0.10), 2);
  v_winner := case
    when v_roll_a > v_roll_b then v_match.team_a_id
    when v_roll_b > v_roll_a then v_match.team_b_id
    when random() < 0.5 then v_match.team_a_id
    else v_match.team_b_id
  end;
  v_loser := case when v_winner = v_match.team_a_id then v_match.team_b_id else v_match.team_a_id end;

  update public.matches
  set winner_team_id = v_winner,
      combat_power_a = v_cp_a,
      combat_power_b = v_cp_b,
      rolled_power_a = v_roll_a,
      rolled_power_b = v_roll_b,
      completed_at = now()
  where id = p_match_id;

  update public.tournament_teams set status = 'eliminated' where id = v_loser;

  select config_value into v_config from public.system_configs where config_key = 'fatigue';
  v_fatigue_increase := coalesce((v_config ->> 'per_match')::numeric, 0.3);
  update public.character_stats
  set fatigue_penalty = fatigue_penalty + v_fatigue_increase,
      last_match_at = now(),
      updated_at = now()
  where user_id in (v_team_a.player_a_id, v_team_a.player_b_id, v_team_b.player_a_id, v_team_b.player_b_id);

  v_team_count := v_tournament.max_pairs;
  while v_team_count > 1 loop
    v_team_count := v_team_count / 2;
    v_final_round := v_final_round + 1;
  end loop;

  if v_match.round_number < v_final_round then
    v_next_match_number := ceil(v_match.match_number::numeric / 2)::integer;
    update public.matches
    set team_a_id = case when mod(v_match.match_number, 2) = 1 then v_winner else team_a_id end,
        team_b_id = case when mod(v_match.match_number, 2) = 0 then v_winner else team_b_id end
    where tournament_id = v_match.tournament_id
      and round_number = v_match.round_number + 1
      and match_number = v_next_match_number;
    if not found then
      raise exception using errcode = 'P0002', message = 'Next bracket match not found.';
    end if;
    v_advanced := true;
  else
    update public.tournament_teams set status = 'champion' where id = v_winner;
    update public.tournaments set status = 'completed' where id = v_tournament.id;

    select config_value into v_rewards from public.system_configs where config_key = 'tournament_rewards';
    v_champion_skill := coalesce((v_rewards -> 'champion' ->> 'skill_points')::integer, 3);
    v_champion_body := coalesce((v_rewards -> 'champion' ->> 'body_points')::integer, 3);
    v_champion_points := coalesce((v_rewards -> 'champion' ->> 'reward_points')::bigint, 500);
    v_runner_skill := coalesce((v_rewards -> 'runner_up' ->> 'skill_points')::integer, 2);
    v_runner_body := coalesce((v_rewards -> 'runner_up' ->> 'body_points')::integer, 2);
    v_runner_points := coalesce((v_rewards -> 'runner_up' ->> 'reward_points')::bigint, 250);

    for v_player_id in
      select player_a_id from public.tournament_teams where id = v_winner
      union all
      select player_b_id from public.tournament_teams where id = v_winner
    loop
      update public.profiles
      set unspent_skill_points = unspent_skill_points + v_champion_skill,
          unspent_body_points = unspent_body_points + v_champion_body,
          reward_points = reward_points + v_champion_points,
          updated_at = now()
      where id = v_player_id;
      insert into public.wallet_ledger (user_id, points_delta, reason, reference_id, idempotency_key)
      values (v_player_id, v_champion_points, 'tournament_champion', v_tournament.id::text,
        'tournament:' || v_tournament.id::text || ':champion:' || v_player_id::text);
    end loop;

    for v_player_id in
      select player_a_id from public.tournament_teams where id = v_loser
      union all
      select player_b_id from public.tournament_teams where id = v_loser
    loop
      update public.profiles
      set unspent_skill_points = unspent_skill_points + v_runner_skill,
          unspent_body_points = unspent_body_points + v_runner_body,
          reward_points = reward_points + v_runner_points,
          updated_at = now()
      where id = v_player_id;
      insert into public.wallet_ledger (user_id, points_delta, reason, reference_id, idempotency_key)
      values (v_player_id, v_runner_points, 'tournament_runner_up', v_tournament.id::text,
        'tournament:' || v_tournament.id::text || ':runner-up:' || v_player_id::text);
    end loop;
  end if;

  return jsonb_build_object(
    'match_id', p_match_id,
    'winner_team_id', v_winner,
    'combat_power_a', v_cp_a,
    'combat_power_b', v_cp_b,
    'rolled_power_a', v_roll_a,
    'rolled_power_b', v_roll_b,
    'advanced', v_advanced,
    'tournament_completed', not v_advanced
  );
end;
$$;

revoke all on function public.resolve_tournament_match(uuid) from public, anon;
grant execute on function public.resolve_tournament_match(uuid) to authenticated;

commit;
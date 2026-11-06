begin;

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
  v_final_round integer;
  v_bracket_size integer := 1;
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

  v_final_round := nullif(v_tournament.bracket_data ->> 'rounds', '')::integer;
  if v_final_round is null or v_final_round < 1 then
    v_final_round := 0;
    while v_bracket_size < greatest(2, v_tournament.max_pairs) loop
      v_bracket_size := v_bracket_size * 2;
      v_final_round := v_final_round + 1;
    end loop;
    v_final_round := greatest(1, v_final_round);
  end if;

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
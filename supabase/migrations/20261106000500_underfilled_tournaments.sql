begin;

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
  v_pair_count integer;
  v_bracket_size integer := 1;
  v_byes integer;
  v_player_a uuid;
  v_player_b uuid;
  v_team_id uuid;
  v_index integer;
  v_match_number integer;
  v_match_count integer;
  v_round_number integer := 1;
  v_final_round integer := 1;
  v_next_match_number integer;
  v_bye_match record;
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

  select array_agg(entry.user_id order by random()) into v_players
  from public.tournament_entries as entry
  where entry.tournament_id = p_tournament_id
    and entry.status = 'registered';

  if coalesce(cardinality(v_players), 0) < 4 then
    raise exception using errcode = 'P0001', message = 'At least two complete pairs are required.';
  end if;
  if mod(cardinality(v_players), 2) <> 0 then
    raise exception using errcode = 'P0001', message = 'Registration needs an even number of players.';
  end if;

  v_pair_count := cardinality(v_players) / 2;
  if v_pair_count > v_tournament.max_pairs then
    raise exception using errcode = 'P0001', message = 'Registered players exceed tournament capacity.';
  end if;
  while v_bracket_size < v_pair_count loop
    v_bracket_size := v_bracket_size * 2;
  end loop;
  v_byes := v_bracket_size - v_pair_count;

  for v_index in 1..v_pair_count loop
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

  v_match_count := v_bracket_size / 2;
  loop
    for v_match_number in 1..v_match_count loop
      if v_round_number = 1 and v_match_number <= v_byes then
        insert into public.matches (
          tournament_id, round_number, match_number, team_a_id,
          winner_team_id, scheduled_at, completed_at
        )
        values (
          p_tournament_id, v_round_number, v_match_number,
          v_teams[v_match_number], v_teams[v_match_number],
          v_tournament.starts_at, now()
        );
      elsif v_round_number = 1 then
        v_index := (v_match_number * 2) - v_byes - 1;
        insert into public.matches (tournament_id, round_number, match_number, team_a_id, team_b_id, scheduled_at)
        values (
          p_tournament_id, v_round_number, v_match_number,
          v_teams[v_index], v_teams[v_index + 1], v_tournament.starts_at
        );
      else
        insert into public.matches (tournament_id, round_number, match_number, scheduled_at)
        values (p_tournament_id, v_round_number, v_match_number, v_tournament.starts_at);
      end if;
    end loop;

    exit when v_match_count = 1;
    v_match_count := v_match_count / 2;
    v_round_number := v_round_number + 1;
    v_final_round := v_final_round + 1;
  end loop;

  for v_bye_match in
    select match_number, winner_team_id
    from public.matches
    where tournament_id = p_tournament_id
      and round_number = 1
      and winner_team_id is not null
  loop
    v_next_match_number := ceil(v_bye_match.match_number::numeric / 2)::integer;
    update public.matches
    set team_a_id = case when mod(v_bye_match.match_number, 2) = 1 then v_bye_match.winner_team_id else team_a_id end,
        team_b_id = case when mod(v_bye_match.match_number, 2) = 0 then v_bye_match.winner_team_id else team_b_id end
    where tournament_id = p_tournament_id
      and round_number = 2
      and match_number = v_next_match_number;
  end loop;

  update public.tournaments
  set status = 'in_progress',
      max_pairs = v_pair_count,
      bracket_data = bracket_data || jsonb_build_object(
        'capacity_pairs', v_tournament.max_pairs,
        'actual_pairs', v_pair_count,
        'bracket_size', v_bracket_size,
        'rounds', v_final_round,
        'byes', v_byes
      )
  where id = p_tournament_id;

  return jsonb_build_object(
    'tournament_id', p_tournament_id,
    'status', 'in_progress',
    'pairs', v_pair_count,
    'bracket_size', v_bracket_size,
    'byes', v_byes,
    'rounds', v_final_round
  );
end;
$$;

revoke all on function public.start_random_tournament(uuid) from public, anon, authenticated;

create or replace function public.admin_start_tournament(p_tournament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;

  select role into v_role from public.profiles where id = v_user_id;
  if v_role is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Admin role required.';
  end if;

  return public.start_random_tournament(p_tournament_id);
end;
$$;

revoke all on function public.admin_start_tournament(uuid) from public, anon;
grant execute on function public.admin_start_tournament(uuid) to authenticated;

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

  if v_entries_count = v_tournament.max_pairs * 2
    or (
      v_tournament.starts_at is not null
      and now() >= v_tournament.starts_at
      and v_entries_count >= 4
      and mod(v_entries_count, 2) = 0
    ) then
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

commit;
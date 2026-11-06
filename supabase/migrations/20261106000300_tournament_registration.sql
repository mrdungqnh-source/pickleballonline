begin;

insert into public.tournaments (
  id, name, level_bracket, max_pairs, matching_type, status,
  registration_opens_at, starts_at
)
values
  ('11111111-1111-4111-8111-111111111010', 'Rookie Rally', 10, 32, 'random', 'open', now(), now() + interval '6 days'),
  ('11111111-1111-4111-8111-111111111020', 'Club Championship', 10, 32, 'random', 'open', now(), now() + interval '12 days')
on conflict (id) do update
set name = excluded.name,
    level_bracket = excluded.level_bracket,
    max_pairs = excluded.max_pairs,
    matching_type = excluded.matching_type,
    status = excluded.status,
    starts_at = excluded.starts_at;

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

  select level into v_level
  from public.profiles
  where id = v_user_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Player profile not found.';
  end if;
  if v_level < v_tournament.level_bracket then
    raise exception using errcode = 'P0001', message = 'Player level is below this tournament bracket.';
  end if;

  if exists (
    select 1 from public.tournament_entries
    where tournament_id = p_tournament_id
      and user_id = v_user_id
      and status <> 'withdrawn'
  ) then
    raise exception using errcode = '23505', message = 'Already registered for this tournament.';
  end if;

  select count(*) into v_entries_count
  from public.tournament_entries
  where tournament_id = p_tournament_id
    and status in ('registered', 'confirmed', 'paired');

  if v_entries_count >= v_tournament.max_pairs * 2 then
    raise exception using errcode = 'P0001', message = 'Tournament registration is full.';
  end if;

  insert into public.tournament_entries (tournament_id, user_id, status)
  values (p_tournament_id, v_user_id, 'registered')
  returning id into v_entry_id;

  return jsonb_build_object(
    'entry_id', v_entry_id,
    'tournament_id', p_tournament_id,
    'status', 'registered',
    'entries_count', v_entries_count + 1,
    'max_players', v_tournament.max_pairs * 2
  );
end;
$$;

revoke all on function public.register_for_tournament(uuid) from public, anon;
grant execute on function public.register_for_tournament(uuid) to authenticated;

commit;
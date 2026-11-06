begin;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (char_length(btrim(username)) between 3 and 24),
  role text not null default 'player' check (role in ('player', 'admin')),
  avatar_url text,
  reward_points bigint not null default 0 check (reward_points >= 0),
  cash_balance bigint not null default 0 check (cash_balance >= 0),
  level integer not null default 1 check (level >= 1),
  current_exp bigint not null default 0 check (current_exp >= 0),
  unspent_skill_points integer not null default 0 check (unspent_skill_points >= 0),
  unspent_body_points integer not null default 0 check (unspent_body_points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_username_lower_idx on public.profiles (lower(username));

create table public.items (
  id text primary key,
  name text not null,
  category text not null check (category in ('racket', 'shirt', 'pants', 'shoes', 'hat', 'glasses')),
  image_url text,
  is_starter_item boolean not null default false,
  price_points bigint not null default 0 check (price_points >= 0),
  price_cash bigint not null default 0 check (price_cash >= 0),
  buffs jsonb not null default '{}'::jsonb check (jsonb_typeof(buffs) = 'object'),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.character_stats (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  stamina integer not null default 10 check (stamina >= 0),
  flexibility integer not null default 10 check (flexibility >= 0),
  agility integer not null default 10 check (agility >= 0),
  fatigue_penalty numeric(6,2) not null default 0 check (fatigue_penalty >= 0),
  last_match_at timestamptz,
  skills jsonb not null default '{"drive":1,"drop":1,"backhand":1,"dink":1}'::jsonb check (jsonb_typeof(skills) = 'object'),
  equipped_racket_id text references public.items (id),
  equipped_shirt_id text references public.items (id),
  equipped_pants_id text references public.items (id),
  equipped_shoes_id text references public.items (id),
  equipped_hat_id text references public.items (id),
  equipped_glasses_id text references public.items (id),
  updated_at timestamptz not null default now()
);

create table public.inventory (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_id text not null references public.items (id),
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  level_bracket integer not null check (level_bracket >= 1),
  max_pairs integer not null default 32 check (max_pairs > 0),
  matching_type text not null check (matching_type in ('random', 'partner_invite')),
  status text not null default 'draft' check (status in ('draft', 'open', 'in_progress', 'completed', 'cancelled')),
  registration_opens_at timestamptz,
  starts_at timestamptz,
  bracket_data jsonb not null default '{}'::jsonb check (jsonb_typeof(bracket_data) = 'object'),
  created_at timestamptz not null default now()
);

create table public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  invited_partner_id uuid references public.profiles (id),
  status text not null default 'registered' check (status in ('registered', 'invited', 'confirmed', 'paired', 'withdrawn')),
  created_at timestamptz not null default now(),
  unique (tournament_id, user_id)
);

create table public.tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  player_a_id uuid not null references public.profiles (id),
  player_b_id uuid not null references public.profiles (id),
  seed integer,
  status text not null default 'active' check (status in ('active', 'eliminated', 'champion', 'forfeit')),
  created_at timestamptz not null default now(),
  unique (tournament_id, id),
  check (player_a_id <> player_b_id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round_number integer not null check (round_number > 0),
  match_number integer not null check (match_number > 0),
  team_a_id uuid,
  team_b_id uuid,
  winner_team_id uuid,
  scheduled_at timestamptz,
  completed_at timestamptz,
  unique (tournament_id, round_number, match_number),
  foreign key (tournament_id, team_a_id) references public.tournament_teams (tournament_id, id),
  foreign key (tournament_id, team_b_id) references public.tournament_teams (tournament_id, id),
  foreign key (tournament_id, winner_team_id) references public.tournament_teams (tournament_id, id),
  check (team_a_id is null or team_b_id is null or team_a_id <> team_b_id),
  check (winner_team_id is null or winner_team_id = team_a_id or winner_team_id = team_b_id)
);

create table public.wallet_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete restrict,
  points_delta bigint not null default 0,
  cash_delta bigint not null default 0,
  reason text not null,
  reference_id text,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  check (points_delta <> 0 or cash_delta <> 0)
);

create table public.system_configs (
  config_key text primary key,
  config_value jsonb not null,
  is_public boolean not null default true,
  updated_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen_username text;
begin
  chosen_username := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
    'player-' || left(new.id::text, 8)
  );

  insert into public.profiles (id, username)
  values (new.id, chosen_username);

  insert into public.character_stats (user_id)
  values (new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.items enable row level security;
alter table public.character_stats enable row level security;
alter table public.inventory enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_teams enable row level security;
alter table public.matches enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.system_configs enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
create policy character_stats_select_own on public.character_stats
  for select to authenticated using ((select auth.uid()) = user_id);
create policy inventory_select_own on public.inventory
  for select to authenticated using ((select auth.uid()) = user_id);
create policy wallet_ledger_select_own on public.wallet_ledger
  for select to authenticated using ((select auth.uid()) = user_id);
create policy items_read_active on public.items
  for select to anon, authenticated using (is_active);
create policy tournaments_read_published on public.tournaments
  for select to anon, authenticated using (status <> 'draft');
create policy tournament_entries_select_own on public.tournament_entries
  for select to authenticated using ((select auth.uid()) = user_id or (select auth.uid()) = invited_partner_id);
create policy tournament_teams_read_published on public.tournament_teams
  for select to anon, authenticated using (
    exists (select 1 from public.tournaments t where t.id = tournament_id and t.status <> 'draft')
  );
create policy matches_read_published on public.matches
  for select to anon, authenticated using (
    exists (select 1 from public.tournaments t where t.id = tournament_id and t.status <> 'draft')
  );
create policy system_configs_read_public on public.system_configs
  for select to anon, authenticated using (is_public);

revoke all on public.profiles, public.items, public.character_stats, public.inventory,
  public.tournaments, public.tournament_entries, public.tournament_teams, public.matches,
  public.wallet_ledger, public.system_configs from anon, authenticated;

grant select on public.profiles, public.character_stats, public.inventory,
  public.tournament_entries, public.wallet_ledger to authenticated;
grant update (username, avatar_url) on public.profiles to authenticated;
grant select on public.items, public.tournaments, public.tournament_teams,
  public.matches, public.system_configs to anon, authenticated;
grant all on public.profiles, public.items, public.character_stats, public.inventory,
  public.tournaments, public.tournament_entries, public.tournament_teams, public.matches,
  public.wallet_ledger, public.system_configs to service_role;
revoke all on function public.handle_new_user() from public, anon, authenticated;

insert into public.items (id, name, category, is_starter_item, price_points, buffs)
values
  ('racket-1', 'Carbon Rally 01', 'racket', false, 520, '{"drive":2,"drop":1}'),
  ('shirt-1', 'Club Jersey / Moss', 'shirt', false, 280, '{"stamina":1}'),
  ('shoes-1', 'Court Sprint Pro', 'shoes', false, 430, '{"agility":2}'),
  ('hat-1', 'Baseline Cap', 'hat', false, 190, '{"flexibility":1}'),
  ('glasses-1', 'Court Vision', 'glasses', false, 240, '{"backhand":1}'),
  ('racket-2', 'Control Series 02', 'racket', false, 700, '{"dink":3,"volley":1}')
on conflict (id) do nothing;

insert into public.system_configs (config_key, config_value)
values
  ('progression', '{"base_exp":100,"difficulty":1.5,"skill_points_per_level":1,"body_points_per_level":1}'),
  ('fatigue', '{"per_match":0.3,"recovery_hours":4}'),
  ('advanced_skills', '{"unlock_level":40}')
on conflict (config_key) do nothing;

commit;
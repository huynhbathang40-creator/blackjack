-- Opening-move stats: judge the first decision of each round by the round result.
create or replace function public.get_play_stats(p_strategy text default 'all')
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with
me as (select (select auth.uid()) as uid),
r as (
  select rd.* from public.rounds rd, me
  where rd.user_id = me.uid
    and (p_strategy = 'all'
         or (p_strategy = 'none' and rd.strategy_id is null)
         or rd.strategy_id::text = p_strategy)
),
h as (
  select hd.*, r.dealer_upcard_value, r.true_count as round_true_count
  from public.round_hands hd join r on r.id = hd.round_id
),
d as (
  select dc.*, h.net as hand_net, h.outcome as hand_outcome
  from public.decisions dc join h on h.round_id = dc.round_id and h.hand_index = dc.hand_index
),
ordered as (
  select id, result, net, played_at,
         row_number() over (order by played_at, id) as n,
         sum(net) over (order by played_at, id) as cum
  from r
),
runs as (
  select result, count(*) as len, max(n) as last_n
  from (
    select result, n, n - row_number() over (partition by result order by n) as grp
    from ordered where result <> 'push'
  ) x
  group by result, grp
)
select jsonb_build_object(
  'overview', (
    select jsonb_build_object(
      'rounds', count(*),
      'round_wins', count(*) filter (where result = 'win'),
      'round_losses', count(*) filter (where result = 'lose'),
      'round_pushes', count(*) filter (where result = 'push'),
      'wagered', coalesce(sum(total_bet), 0),
      'net', coalesce(sum(net), 0),
      'avg_bet', avg(total_bet),
      'best_round', max(net),
      'worst_round', min(net),
      'first_played', min(played_at),
      'last_played', max(played_at)
    ) from r
  ),
  'hands', (
    select jsonb_build_object(
      'hands', count(*),
      'wins', count(*) filter (where outcome = 'win'),
      'blackjacks', count(*) filter (where outcome = 'blackjack'),
      'pushes', count(*) filter (where outcome = 'push'),
      'losses', count(*) filter (where outcome = 'lose'),
      'busts', count(*) filter (where outcome = 'bust'),
      'doubles', count(*) filter (where doubled),
      'doubles_won', count(*) filter (where doubled and outcome in ('win', 'blackjack')),
      'split_hands', count(*) filter (where from_split)
    ) from h
  ),
  'decisions', (
    select jsonb_build_object(
      'total', count(*),
      'matched', count(*) filter (where matched_basic),
      'avg_ms', round(avg(ms_to_decide)),
      'by_type', coalesce((
        select jsonb_agg(jsonb_build_object('type', kind, 'total', total, 'matched', matched) order by kind)
        from (
          select case when pair then 'Pairs' when soft then 'Soft hands' else 'Hard hands' end as kind,
                 count(*) as total, count(*) filter (where matched_basic) as matched
          from d group by 1
        ) t
      ), '[]'::jsonb)
    ) from d
  ),
  'streaks', jsonb_build_object(
    'longest_win', (select coalesce(max(len), 0) from runs where result = 'win'),
    'longest_loss', (select coalesce(max(len), 0) from runs where result = 'lose'),
    'current', (select jsonb_build_object('result', result, 'length', len) from runs order by last_n desc limit 1)
  ),
  'timeline', coalesce((
    select jsonb_agg(jsonb_build_object('n', n, 'at', played_at, 'net', net, 'cum', cum) order by n)
    from (select * from ordered order by n desc limit 2000) t
  ), '[]'::jsonb),
  'by_upcard', coalesce((
    select jsonb_agg(jsonb_build_object(
      'upcard', up, 'hands', hands, 'wins', wins, 'losses', losses, 'pushes', pushes,
      'net', net, 'wagered', wagered) order by up)
    from (
      select dealer_upcard_value as up, count(*) as hands,
             count(*) filter (where outcome in ('win', 'blackjack')) as wins,
             count(*) filter (where outcome in ('lose', 'bust')) as losses,
             count(*) filter (where outcome = 'push') as pushes,
             sum(net) as net, sum(bet) as wagered
      from h where dealer_upcard_value is not null group by 1
    ) t
  ), '[]'::jsonb),
  'by_start', coalesce((
    select jsonb_agg(jsonb_build_object(
      'situation', situation, 'hands', hands, 'wins', wins, 'losses', losses, 'pushes', pushes,
      'net', net, 'wagered', wagered) order by hands desc, situation)
    from (
      select situation, count(*) as hands,
             count(*) filter (where outcome in ('win', 'blackjack')) as wins,
             count(*) filter (where outcome in ('lose', 'bust')) as losses,
             count(*) filter (where outcome = 'push') as pushes,
             sum(net) as net, sum(bet) as wagered
      from h where not from_split and situation is not null group by 1
    ) t
  ), '[]'::jsonb),
  'by_first_action', coalesce((
    select jsonb_agg(jsonb_build_object(
      'action', action, 'rounds', rounds, 'wins', wins, 'losses', losses, 'pushes', pushes,
      'net', net, 'wagered', wagered) order by rounds desc)
    from (
      -- The opening move of each round (first decision on the original hand),
      -- judged by the result of the whole round. 'none' = no decision (a natural).
      select coalesce(f.action, 'none') as action, count(*) as rounds,
             count(*) filter (where r.result = 'win') as wins,
             count(*) filter (where r.result = 'lose') as losses,
             count(*) filter (where r.result = 'push') as pushes,
             sum(r.net) as net, sum(r.total_bet) as wagered
      from r
      left join lateral (
        select d.action from d where d.round_id = r.id order by d.seq limit 1
      ) f on true
      group by 1
    ) t
  ), '[]'::jsonb),
  'mistakes', coalesce((
    select jsonb_agg(jsonb_build_object(
      'situation', situation, 'upcard', up, 'action', action, 'recommended', recommended,
      'times', times, 'net', net) order by times desc, net)
    from (
      select situation, dealer_upcard_value as up, action, recommended,
             count(*) as times, sum(hand_net) as net
      from d where not matched_basic
      group by 1, 2, 3, 4
      order by count(*) desc, sum(hand_net)
      limit 15
    ) t
  ), '[]'::jsonb),
  'by_true_count', coalesce((
    select jsonb_agg(jsonb_build_object(
      'bucket', bucket, 'rounds', rounds, 'net', net, 'wagered', wagered, 'avg_bet', avg_bet) order by bucket)
    from (
      select greatest(-3, least(3, round(true_count)))::int as bucket, count(*) as rounds,
             sum(net) as net, sum(total_bet) as wagered, round(avg(total_bet), 2) as avg_bet
      from r where true_count is not null group by 1
    ) t
  ), '[]'::jsonb),
  'by_strategy', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'rounds', rounds, 'wins', wins, 'net', net, 'wagered', wagered,
      'decisions', decisions, 'matched', matched) order by rounds desc)
    from (
      select s.id, coalesce(s.name, 'No strategy') as name, count(*) as rounds,
             count(*) filter (where ar.result = 'win') as wins,
             sum(ar.net) as net, sum(ar.total_bet) as wagered,
             coalesce(sum(dc.total), 0) as decisions, coalesce(sum(dc.matched), 0) as matched
      from public.rounds ar
      cross join me
      left join public.strategies s on s.id = ar.strategy_id
      left join lateral (
        select count(*) as total, count(*) filter (where x.matched_basic) as matched
        from public.decisions x where x.round_id = ar.id
      ) dc on true
      where ar.user_id = me.uid
      group by s.id, s.name
    ) t
  ), '[]'::jsonb)
);
$$;


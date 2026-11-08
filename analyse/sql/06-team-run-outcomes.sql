-- Last seen status of each tstack team run, parsed from tstack status/fleet tool results,
-- rolled up per feature tag. Snapshot-based: runs never polled after dispatch show no final status.
WITH r AS (
  SELECT tr.timestamp ts, tr.content c FROM tool_results tr JOIN tool_calls tc ON tc.id = tr.tool_call_id
  WHERE tr.content LIKE '%teamRun.featureTag%'),
h AS (
  SELECT ts, unnest(regexp_extract_all(c, '(?:feature|fix|chore)/[^,]+,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12},(?:true|false),.*?,[a-z_]+,20[0-9][0-9]-')) m FROM r),
p AS (
  SELECT ts, split_part(m, ',', 1) tag, split_part(m, ',', 2) id, regexp_extract(m, ',([a-z_]+),20[0-9][0-9]-$', 1) st FROM h),
runs AS (SELECT tag, id, arg_max(st, ts) st FROM p GROUP BY 1, 2),
tags AS (SELECT tag, count(*) n_runs, bool_or(st = 'completed') any_done, sum((st = 'stopped')::INT) n_stop FROM runs GROUP BY 1)
SELECT CASE WHEN any_done THEN 'feature eventually completed' WHEN n_stop > 0 THEN 'stopped, never completed' ELSE 'no final status' END outcome,
  count(*) features, sum(n_runs) runs, sum(n_stop) stopped_runs, round(avg(n_runs), 1) runs_per_feature
FROM tags GROUP BY 1 ORDER BY 2 DESC;

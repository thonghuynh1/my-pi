-- Wall-clock session length (minutes) per era and kind.
WITH ss AS (
  SELECT s.started_at, s.ended_at,
    CASE WHEN s.import_path ILIKE '%tstack-worker-sessions%' THEN 'worker'
         WHEN s.import_path ILIKE '%tstack-side-conversation%' THEN 'side' ELSE 'main' END kind,
    CASE WHEN s.started_at < '{{CUTOFF}}' THEN '1_before' ELSE '2_after' END era
  FROM sessions s WHERE s.source = 'pi' AND s.started_at >= '{{SINCE}}' AND s.ended_at IS NOT NULL)
SELECT era, kind, count(*) sessions,
  round(median(date_diff('second', started_at, ended_at))/60, 1) median_min,
  round(quantile_cont(date_diff('second', started_at, ended_at), 0.9)/60) p90_min
FROM ss GROUP BY 1, 2 ORDER BY 1, 2;

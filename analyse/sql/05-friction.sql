-- Tool error rate (Pi tool_results.is_error) per era and kind.
WITH ss AS (
  SELECT s.id sid,
    CASE WHEN s.import_path ILIKE '%tstack-worker-sessions%' THEN 'worker'
         WHEN s.import_path ILIKE '%tstack-side-conversation%' THEN 'side' ELSE 'main' END kind,
    CASE WHEN s.started_at < '{{CUTOFF}}' THEN '1_before' ELSE '2_after' END era
  FROM sessions s WHERE s.source = 'pi' AND s.started_at >= '{{SINCE}}')
SELECT era, kind, count(*) calls, sum(tr.is_error::INT) errors, round(sum(tr.is_error::INT)*100.0/count(*), 1) error_pct
FROM ss JOIN tool_calls tc ON tc.session_id = ss.sid JOIN tool_results tr ON tr.tool_call_id = tc.id
GROUP BY 1, 2 ORDER BY 1, 2;

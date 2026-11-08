-- Tokens per repository (Project name, else last path segment) per era, main chat vs tstack.
WITH s AS (
  SELECT s.id sid,
    coalesce(p.name, regexp_extract(s.source_path, '([^\\/]+)$', 1)) repo,
    CASE WHEN s.started_at < '{{CUTOFF}}' THEN '1_before' ELSE '2_after' END era,
    CASE WHEN s.import_path ILIKE '%tstack-%sessions%' THEN 'tstack' ELSE 'main' END via
  FROM sessions s LEFT JOIN projects p ON p.id = s.project_id
  WHERE s.source = 'pi' AND s.started_at >= '{{SINCE}}')
SELECT repo, era, via, count(DISTINCT s.sid) sessions,
  round(sum(CAST(json_extract(m.metadata,'$.usage.input') AS BIGINT) + CAST(json_extract(m.metadata,'$.usage.cacheRead') AS BIGINT)
    + CAST(json_extract(m.metadata,'$.usage.cacheWrite') AS BIGINT))/1e6) in_M,
  round(sum(CAST(json_extract(m.metadata,'$.usage.output') AS BIGINT))/1e6, 1) out_M
FROM s JOIN messages m ON m.session_id = s.sid AND m.role = 'assistant'
GROUP BY 1, 2, 3 HAVING sum(CAST(json_extract(m.metadata,'$.usage.output') AS BIGINT)) > 100000
ORDER BY 1, 2, 3;

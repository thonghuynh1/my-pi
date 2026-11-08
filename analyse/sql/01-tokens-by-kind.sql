-- Token usage per era and session kind (main chat / tstack side conversation / tstack worker).
-- Usage = input + cacheRead + cacheWrite from message metadata; messages.tokens_in is uncached input only.
WITH u AS (
  SELECT s.id sid,
    CASE WHEN s.import_path ILIKE '%tstack-worker-sessions%' THEN 'worker'
         WHEN s.import_path ILIKE '%tstack-side-conversation%' THEN 'side' ELSE 'main' END kind,
    CASE WHEN s.started_at < '{{CUTOFF}}' THEN '1_before' ELSE '2_after' END era,
    CAST(json_extract(m.metadata,'$.usage.input') AS BIGINT)
      + CAST(json_extract(m.metadata,'$.usage.cacheRead') AS BIGINT)
      + CAST(json_extract(m.metadata,'$.usage.cacheWrite') AS BIGINT) ctx,
    CAST(json_extract(m.metadata,'$.usage.cacheRead') AS BIGINT) cr,
    CAST(json_extract(m.metadata,'$.usage.output') AS BIGINT) outp
  FROM sessions s JOIN messages m ON m.session_id = s.id
  WHERE s.source = 'pi' AND m.role = 'assistant' AND s.started_at >= '{{SINCE}}')
SELECT era, kind, count(DISTINCT sid) sessions, count(*) turns,
  round(sum(ctx)/1e6, 1) in_M, round(sum(cr)*100.0/sum(ctx), 1) cache_pct, round(sum(outp)/1e6, 2) out_M,
  round(sum(ctx)/count(DISTINCT sid)/1e3) in_k_per_session, round(avg(ctx)/1e3, 1) avg_ctx_k
FROM u GROUP BY 1, 2 ORDER BY 1, 2;

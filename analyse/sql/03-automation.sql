-- Automation leverage: agent turns and tool results per human-typed message.
-- Background job notices, tstack injections and assignments are not counted as human.
WITH ss AS (
  SELECT s.id sid,
    CASE WHEN s.import_path ILIKE '%tstack-worker-sessions%' THEN 'worker'
         WHEN s.import_path ILIKE '%tstack-side-conversation%' THEN 'side' ELSE 'main' END kind,
    CASE WHEN s.started_at < '{{CUTOFF}}' THEN '1_before' ELSE '2_after' END era
  FROM sessions s WHERE s.source = 'pi' AND s.started_at >= '{{SINCE}}'),
mm AS (
  SELECT ss.*, m.role,
    (m.role = 'user' AND NOT (m.content LIKE '[Background%' OR m.content LIKE '===%'
      OR m.content LIKE 'Your tstack assignment%' OR m.content LIKE '[result]%')) human,
    CAST(json_extract(m.metadata,'$.usage.output') AS BIGINT) outp
  FROM ss JOIN messages m ON m.session_id = ss.sid)
SELECT era, kind, count(DISTINCT sid) sessions, sum(human::INT) human_msgs,
  round(sum(human::INT)*1.0/count(DISTINCT sid), 1) human_per_session,
  round(sum((role='assistant')::INT)*1.0/nullif(sum(human::INT), 0), 1) turns_per_human,
  round(sum((role='tool')::INT)*1.0/nullif(sum(human::INT), 0), 1) tools_per_human,
  round(sum(outp)*1.0/nullif(sum(human::INT), 0)/1e3, 1) out_k_per_human
FROM mm GROUP BY 1, 2 ORDER BY 1, 2;

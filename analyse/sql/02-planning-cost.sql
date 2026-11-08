-- Planning cost: old main-chat planning sessions vs new orchestrator chats plus the
-- side conversations and workers they launched. Children are linked to the parent that
-- mentions their tstack session id and was active when the child started; "catalog"
-- sessions mentioning more than 60 children are ignored.
WITH tok AS (
  SELECT s.id sid,
    sum(CAST(json_extract(m.metadata,'$.usage.input') AS BIGINT) + CAST(json_extract(m.metadata,'$.usage.cacheRead') AS BIGINT)
      + CAST(json_extract(m.metadata,'$.usage.cacheWrite') AS BIGINT)) ctx
  FROM sessions s JOIN messages m ON m.session_id = s.id
  WHERE s.source = 'pi' AND m.role = 'assistant' GROUP BY 1),
child AS (
  SELECT id sid, CASE WHEN import_path ILIKE '%tstack-worker-sessions%' THEN 'worker' ELSE 'side' END kind,
    regexp_extract(import_path, 'sessions[\/]([0-9a-f-]{36})', 1) cid
  FROM sessions WHERE import_path ILIKE '%tstack-%sessions%'),
mainmsg AS (
  SELECT m.session_id msid, m.content txt FROM messages m JOIN sessions s ON s.id = m.session_id
  WHERE s.source = 'pi' AND s.import_path NOT ILIKE '%tstack-%sessions%' AND s.started_at >= '{{SINCE}}' AND m.role IN ('tool', 'assistant')
  UNION ALL
  SELECT m.session_id, CAST(tc.tool_input AS VARCHAR) FROM tool_calls tc JOIN messages m ON m.id = tc.message_id WHERE tc.tool_name ILIKE 'tstack%'),
raw AS (
  SELECT DISTINCT c.sid csid, c.kind, mm.msid FROM child c JOIN mainmsg mm ON contains(mm.txt, c.cid)
  JOIN sessions cs ON cs.id = c.sid JOIN sessions ms ON ms.id = mm.msid
  WHERE ms.started_at <= cs.started_at AND coalesce(ms.ended_at, ms.started_at) >= cs.started_at),
fan AS (SELECT msid, count(*) k FROM raw GROUP BY 1),
link AS (
  SELECT r.csid, r.kind, arg_max(r.msid, ms.started_at) msid
  FROM raw r JOIN fan USING (msid) JOIN sessions ms ON ms.id = r.msid WHERE fan.k <= 60 GROUP BY 1, 2),
orch AS (
  SELECT DISTINCT msid FROM link
  UNION SELECT DISTINCT m.session_id FROM tool_calls tc JOIN messages m ON m.id = tc.message_id WHERE tc.tool_name ILIKE 'tstack%'),
f AS (SELECT session_id, arg_min(content, turn) fm FROM messages WHERE role = 'user' GROUP BY 1),
oldplan AS (
  SELECT s.id FROM sessions s JOIN f ON f.session_id = s.id
  WHERE s.source = 'pi' AND s.import_path NOT ILIKE '%tstack-%sessions%' AND s.started_at >= '{{SINCE}}' AND s.started_at < '{{CUTOFF}}'
    AND (f.fm ILIKE '%grill%' OR f.fm ILIKE '%to-prd%' OR f.fm ILIKE '%to-issues%' OR f.fm ILIKE 'plan%' OR f.fm ILIKE '% plan %' OR f.fm ILIKE '%brainstorm%')),
per AS (
  SELECT 'A_old_main_planning' grp, t.ctx own, 0 sd, 0 wrk FROM tok t JOIN oldplan p ON p.id = t.sid
  UNION ALL
  SELECT 'B_new_orchestrator', coalesce(t.ctx, 0),
    coalesce((SELECT sum(t2.ctx) FROM link l JOIN tok t2 ON t2.sid = l.csid WHERE l.msid = o.msid AND l.kind = 'side'), 0),
    coalesce((SELECT sum(t2.ctx) FROM link l JOIN tok t2 ON t2.sid = l.csid WHERE l.msid = o.msid AND l.kind = 'worker'), 0)
  FROM orch o LEFT JOIN tok t ON t.sid = o.msid)
SELECT grp || CASE WHEN grp LIKE 'B%' THEN CASE WHEN sd > 0 THEN '_with_side' ELSE '_no_side' END ELSE '' END grp, count(*) n,
  round(avg(own)/1e6, 2) own_M, round(avg(sd)/1e6, 2) side_M, round(avg(wrk)/1e6, 2) worker_M, round(avg(own+sd+wrk)/1e6, 2) total_M,
  round(median(own)/1e6, 2) med_own_M, round(median(own+sd)/1e6, 2) med_plan_M
FROM per GROUP BY 1
UNION ALL SELECT 'links_' || kind, count(*), NULL, NULL, NULL, NULL, NULL, NULL FROM link GROUP BY kind
ORDER BY 1;

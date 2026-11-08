# tstack analysis report (DESKTOP-LJB4PL8, 2026-11-09 00:43)

Generated from `analyse/out/`. Metric definitions and confidence: [MEASURES.md](../MEASURES.md).

## Cost by session kind

_Tokens = input + cacheRead + cacheWrite; in_M in millions._

| era | kind | sessions | turns | in_M | cache_pct | out_M | in_k_per_session | avg_ctx_k |
|---|---|---|---|---|---|---|---|---|
| 1_before | main | 2594 | 78766 | 7226.0 | 92.7 | 38.98 | 2786.0 | 91.7 |
| 2_after | main | 1154 | 50564 | 5516.0 | 95.3 | 28.96 | 4780.0 | 109.1 |
| 2_after | side | 121 | 7385 | 872.6 | 94.9 | 5.45 | 7212.0 | 118.2 |
| 2_after | worker | 702 | 30882 | 2802.4 | 97.3 | 10.93 | 3992.0 | 90.7 |

## Planning cost per effort

_A = old in-chat planning session; B = main chat plus linked side conversations and workers (millions)._

| grp | n | own_M | side_M | worker_M | total_M | med_own_M | med_plan_M |
|---|---|---|---|---|---|---|---|
| A_old_main_planning | 633 | 4.76 | 0.0 | 0.0 | 4.76 | 1.84 | 1.84 |
| B_new_orchestrator_no_side | 259 | 6.17 | 0.0 | 7.05 | 13.22 | 2.39 | 2.39 |
| B_new_orchestrator_with_side | 70 | 9.48 | 12.47 | 13.85 | 35.8 | 4.4 | 13.15 |
| links_side | 121 |  |  |  |  |  |  |
| links_worker | 656 |  |  |  |  |  |  |

## Automation

_Agent turns and tool calls per human-typed message._

| era | kind | sessions | human_msgs | human_per_session | turns_per_human | tools_per_human | out_k_per_human |
|---|---|---|---|---|---|---|---|
| 1_before | main | 2594 | 10645 | 4.1 | 7.4 | 10.9 | 3.7 |
| 2_after | main | 1155 | 6429 | 5.6 | 7.9 | 8.5 | 4.5 |
| 2_after | side | 121 | 997 | 8.2 | 7.4 | 8.1 | 5.5 |
| 2_after | worker | 704 | 389 | 0.6 | 79.4 | 79.6 | 28.1 |

## Session length

_Minutes from session start to end._

| era | kind | sessions | median_min | p90_min |
|---|---|---|---|---|
| 1_before | main | 2594 | 4.7 | 137.0 |
| 2_after | main | 1155 | 11.4 | 271.0 |
| 2_after | side | 121 | 75.0 | 952.0 |
| 2_after | worker | 704 | 6.6 | 60.0 |

## Tool errors

_Pi tool_results.is_error._

| era | kind | calls | errors | error_pct |
|---|---|---|---|---|
| 1_before | main | 115593 | 5482 | 4.7 |
| 2_after | main | 54834 | 2654 | 4.8 |
| 2_after | side | 8106 | 363 | 4.5 |
| 2_after | worker | 30974 | 1479 | 4.8 |

## Team-run outcomes

_Last seen status per run, rolled up per feature tag._

| outcome | features | runs | stopped_runs | runs_per_feature |
|---|---|---|---|---|
| stopped, never completed | 10 | 30 | 18 | 3.0 |
| feature eventually completed | 9 | 49 | 15 | 5.4 |
| no final status | 4 | 8 | 0 | 2.0 |

## Tokens by repository

_Project name, else last path segment._

| repo | era | via | sessions | in_M | out_M |
|---|---|---|---|---|---|
| 920287 | 2_after | main | 2 | 29.0 | 0.1 |
| ClaudeConfig | 2_after | main | 9 | 112.0 | 0.7 |
| Documents | 1_before | main | 50 | 184.0 | 1.3 |
| Documents | 2_after | main | 35 | 235.0 | 1.0 |
| Documents | 2_after | tstack | 122 | 530.0 | 2.9 |
| GitRepos | 1_before | main | 15 | 31.0 | 0.2 |
| MyBusiness.Guardrails | 1_before | main | 79 | 286.0 | 2.0 |
| MyBusiness.Guardrails | 2_after | main | 73 | 352.0 | 2.2 |
| Tickets | 1_before | main | 277 | 1277.0 | 6.6 |
| Tickets | 2_after | main | 99 | 555.0 | 2.7 |
| Tickets | 2_after | tstack | 109 | 819.0 | 3.6 |
| aiKnow | 1_before | main | 164 | 516.0 | 3.9 |
| aiLau | 2_after | main | 13 | 31.0 | 0.2 |
| aiLau | 2_after | tstack | 17 | 41.0 | 0.2 |
| aiNho | 1_before | main | 87 | 218.0 | 1.5 |
| aiNho | 2_after | main | 85 | 338.0 | 2.5 |
| aiNho | 2_after | tstack | 86 | 348.0 | 2.0 |
| aiknow-benchmark-rerun | 1_before | main | 2 | 42.0 | 0.3 |
| benchmark | 1_before | main | 562 | 182.0 | 1.3 |
| feature--71164-fix-messagelist-date-divider | 2_after | tstack | 5 | 40.0 | 0.2 |
| feature-66077-move-message-threads-to-tickets | 2_after | main | 5 | 38.0 | 0.2 |
| feature-66240-Documents-Create-new-frotnend-structure | 2_after | tstack | 2 | 89.0 | 0.1 |
| feature-66353-moveActivityToTicket-target | 1_before | main | 13 | 42.0 | 0.3 |
| feature-66551-moveFrontendActivities-target | 1_before | main | 6 | 54.0 | 0.3 |
| feature-66551-moveFrontendActivities-target | 2_after | main | 11 | 200.0 | 0.5 |
| feature-67832-failOutboundMail-target | 2_after | tstack | 8 | 62.0 | 0.4 |
| feature-67832-target | 2_after | tstack | 32 | 282.0 | 0.8 |
| guardrail | 1_before | main | 13 | 19.0 | 0.2 |
| hackathon-grill-me | 1_before | main | 64 | 191.0 | 1.7 |
| hackathon-grill-me | 2_after | main | 59 | 326.0 | 2.5 |
| hackathon-grill-me | 2_after | tstack | 132 | 19.0 | 0.3 |
| hackathon-ralph-loop | 1_before | main | 159 | 341.0 | 1.8 |
| madtom | 1_before | main | 17 | 66.0 | 0.7 |
| my-pi | 1_before | main | 240 | 970.0 | 4.9 |
| my-pi | 2_after | main | 88 | 355.0 | 1.9 |
| pi-selftools | 2_after | main | 35 | 114.0 | 0.6 |
| tstack | 1_before | main | 302 | 2252.0 | 9.6 |
| tstack | 2_after | main | 268 | 2724.0 | 13.2 |
| tstack | 2_after | tstack | 88 | 650.0 | 3.5 |
| tstack-701131df | 2_after | tstack | 12 | 41.0 | 0.1 |
| tstack-bd4187fb | 2_after | tstack | 16 | 144.0 | 0.4 |
| tstack-cf83ecf6 | 2_after | tstack | 15 | 236.0 | 0.3 |
| tstack-ee2a6813 | 1_before | main | 4 | 12.0 | 0.1 |
| tstack-f2ac5fc2 | 2_after | tstack | 8 | 35.0 | 0.3 |
| tstack-f57317ee | 2_after | tstack | 14 | 161.0 | 0.4 |
| tstack-f81aea9d | 1_before | main | 8 | 49.0 | 0.2 |
| tstack-fcd6a2fc | 2_after | tstack | 5 | 15.0 | 0.1 |

## Issue throughput (DESKTOP-LJB4PL8)

_`.scratch` issues: opened and closed per era._

| repo | era | opened | closed_of_opened | close_rate_pct | closed_in_era | median_lead_h |
|---|---|---|---|---|---|---|
|  |
| aiNho | before | 42 | 38 | 90 | 38 | 0.0 |
|  |
| aiNho | after | 61 | 36 | 59 | 36 | 13.7 |
|  |
| my-pi | before | 101 | 84 | 83 | 84 | 0.0 |
|  |
| my-pi | after | 1 | 1 | 100 | 1 | 0.0 |
|  |
| tstack | before | 29 | 26 | 90 | 23 | 0.0 |
|  |
| tstack | after | 435 | 316 | 73 | 319 | 0.0 |
|  |


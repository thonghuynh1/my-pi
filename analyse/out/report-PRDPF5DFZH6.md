# tstack analysis report (PRDPF5DFZH6, 2026-11-09 07:39)

Generated from `analyse/out/`. Metric definitions and confidence: [MEASURES.md](../MEASURES.md).

## Cost by session kind

_Tokens = input + cacheRead + cacheWrite; in_M in millions._

| era | kind | sessions | turns | in_M | cache_pct | out_M | in_k_per_session | avg_ctx_k |
|---|---|---|---|---|---|---|---|---|
| 1_before | main | 2594 | 78766 | 7226.0 | 92.7 | 38.98 | 2786.0 | 91.7 |
| 2_after | main | 1169 | 50998 | 5545.6 | 95.3 | 29.15 | 4744.0 | 108.7 |
| 2_after | side | 124 | 7552 | 897.1 | 95.0 | 5.63 | 7235.0 | 118.8 |
| 2_after | worker | 711 | 31265 | 2839.7 | 97.3 | 11.05 | 3994.0 | 90.8 |

## Planning cost per effort

_A = old in-chat planning session; B = main chat plus linked side conversations and workers (millions)._

| grp | n | own_M | side_M | worker_M | total_M | med_own_M | med_plan_M |
|---|---|---|---|---|---|---|---|
| A_old_main_planning | 633 | 4.76 | 0.0 | 0.0 | 4.76 | 1.84 | 1.84 |
| B_new_orchestrator_no_side | 267 | 6.06 | 0.0 | 7.04 | 13.1 | 2.32 | 2.32 |
| B_new_orchestrator_with_side | 72 | 9.27 | 12.46 | 13.25 | 34.98 | 4.1 | 13.15 |
| links_side | 124 |  |  |  |  |  |  |
| links_worker | 666 |  |  |  |  |  |  |

## Automation

_Agent turns and tool calls per human-typed message._

| era | kind | sessions | human_msgs | human_per_session | turns_per_human | tools_per_human | out_k_per_human |
|---|---|---|---|---|---|---|---|
| 1_before | main | 2594 | 10645 | 4.1 | 7.4 | 10.9 | 3.7 |
| 2_after | main | 1170 | 6503 | 5.6 | 7.8 | 8.5 | 4.5 |
| 2_after | side | 124 | 1039 | 8.4 | 7.3 | 7.9 | 5.4 |
| 2_after | worker | 714 | 401 | 0.6 | 78.0 | 78.0 | 27.5 |

## Session length

_Minutes from session start to end._

| era | kind | sessions | median_min | p90_min |
|---|---|---|---|---|
| 1_before | main | 2594 | 4.7 | 137.0 |
| 2_after | main | 1170 | 11.4 | 270.0 |
| 2_after | side | 124 | 74.7 | 936.0 |
| 2_after | worker | 714 | 6.5 | 60.0 |

## Tool errors

_Pi tool_results.is_error._

| era | kind | calls | errors | error_pct |
|---|---|---|---|---|
| 1_before | main | 115593 | 5482 | 4.7 |
| 2_after | main | 55228 | 2678 | 4.8 |
| 2_after | side | 8258 | 365 | 4.4 |
| 2_after | worker | 31294 | 1495 | 4.8 |

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
| Documents | 2_after | main | 37 | 248.0 | 1.0 |
| Documents | 2_after | tstack | 129 | 540.0 | 2.9 |
| GitRepos | 1_before | main | 15 | 31.0 | 0.2 |
| MyBusiness.Guardrails | 1_before | main | 79 | 286.0 | 2.0 |
| MyBusiness.Guardrails | 2_after | main | 73 | 352.0 | 2.2 |
| Tickets | 1_before | main | 277 | 1277.0 | 6.6 |
| Tickets | 2_after | main | 101 | 555.0 | 2.7 |
| Tickets | 2_after | tstack | 110 | 819.0 | 3.6 |
| aiKnow | 1_before | main | 164 | 516.0 | 3.9 |
| aiLau | 2_after | main | 13 | 31.0 | 0.2 |
| aiLau | 2_after | tstack | 17 | 41.0 | 0.2 |
| aiNho | 1_before | main | 87 | 218.0 | 1.5 |
| aiNho | 2_after | main | 87 | 340.0 | 2.5 |
| aiNho | 2_after | tstack | 87 | 361.0 | 2.0 |
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
| my-pi | 2_after | main | 93 | 365.0 | 2.0 |
| pi-selftools | 2_after | main | 36 | 114.0 | 0.6 |
| tstack | 1_before | main | 302 | 2252.0 | 9.6 |
| tstack | 2_after | main | 270 | 2728.0 | 13.2 |
| tstack | 2_after | tstack | 91 | 689.0 | 3.7 |
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

## Work repo delivery (PRDPF5DFZH6)

Delivery gated on Azure DevOps work item state, not on merge to master. Sessions since 2026-06-01. Tokens = input + cacheRead + cacheWrite.

### Where the ticket-tagged spend sits

| How far the item got in ADO | Items | Tokens | Share | Per item |
|---|---|---|---|---|
| delivered (Done) | 22 | 328M | 13% | 14.9M |
| in test (TST/ACC/review) | 9 | 1,051M | 43% | 116.8M |
| in progress | 7 | 303M | 12% | 43.4M |
| not started (backlog) | 7 | 585M | 24% | 83.6M |
| removed | 2 | 16M | 1% | 8.0M |
| test artifact, not work | 4 | 32M | 1% | 8.0M |
| not a real work item | 33 | 132M | 5% | 4.0M |

**56% of ticket-tagged spend is on work that reached test or Done.** 31 items got that far, tstack involved in 17 of them carrying 1,258M of the 1,379M.

### Same type, same end state, tstack vs main chat

| Type and state | Via | Items | Median | Mean |
|---|---|---|---|---|
| Bug, delivered (Done) | tstack | 1 | 19.7M | 19.7M |
| Bug, in test (TST/ACC/review) | main chat | 1 | 0.0M | 0.0M |
| Bug, in test (TST/ACC/review) | tstack | 1 | 6.3M | 6.3M |
| Product Backlog Item, delivered (Done) | main chat | 5 | 2.4M | 3.6M |
| Product Backlog Item, in test (TST/ACC/review) | tstack | 7 | 124.6M | 149.3M |
| Quality issue, delivered (Done) | main chat | 7 | 3.9M | 14.6M |
| Quality issue, delivered (Done) | tstack | 7 | 4.0M | 25.8M |
| Task, delivered (Done) | main chat | 1 | 1.7M | 1.7M |
| Task, delivered (Done) | tstack | 1 | 6.1M | 6.1M |

### Items delivered or in test

| Work item | State | Repos | Tokens | tstack | Title |
|---|---|---|---|---|---|
| 67832 | Test in ACC | Tickets | 444.0M | yes | Tickets, MailRouter: Display for the user when outgo |
| 70323 | Ready for test | Tickets | 285.1M | yes | Tickets, Messages, Documents :Uncategorized files in |
| 70450 | Review | Documents, Tickets | 124.7M | yes | Tickets, Documents: Uncategorized files inherit tick |
| 66240 | Test in TST | Documents | 124.6M | yes | Documents: Create new frotnend structure |
| 69274 | Done | Documents | 102.5M | yes | No permissions for external users set |
| 70095 | Test in TST | Tickets | 61.9M | yes | Update status when customer replies |
| 70024 | Done | Documents | 60.6M | no | Uploading documents from tickets to one SDT makes th |
| 69364 | Done | Documents | 57.9M | yes | Change category and permissions option in context me |
| 68728 | Done | Tickets | 19.7M | yes | Tickets, MailRouter: Set default subject when subjec |
| 70325 | Done | Documents | 18.5M | no | Expand icon is not changing when expand/collapse in  |
| 70050 | Done | Documents | 16.1M | no | Bulk assigning tags when several selected documents  |
| 71410 | Done | Documents | 11.7M | yes | Not possible to add file from local disc in activity |
| 66173 | Done | Tickets | 8.5M | no | Tickets: Email tickets - Sticky Outbound Email Addre |
| 67791 | Ready for test | Tickets | 6.3M | yes | Activities: Investigate reminders job failling |
| 69611 | Done | Tickets | 6.1M | yes | Add UTC after default subject date |
| 65139 | Done | Tickets | 4.7M | no | Tickets, Messages, Activities: Index ticket data on  |
| 69278 | Done | Documents | 4.0M | yes | Documents section missing in Overview (aggregated vi |
| 71420 | Done | Tickets | 3.9M | no | Update time format |
| 69362 | Done | Documents | 3.6M | yes | Missing warning message in bulk Change category and  |
| 67916 | Ready for test | Tickets | 3.3M | yes | Tickets: Add SignalR for real time updates |
| 68126 | Done | Tickets | 2.4M | no | Tickets: Sort Email tickets, Country filter in Ticke |
| 62587 | Done | Tickets | 2.3M | no | MyBusiness, Locailzations, Documents, Messages: Impl |
| 66897 | Done | Tickets | 1.8M | no | Activity creating modal closed after adding Document |
| 64964 | Done | Documents | 1.7M | no | Step 7 Remove webpack-client migration code and dead |
| 70173 | Ready for test | Tickets | 1.4M | yes | Filter out images from Signatures from uncategorized |
| 69666 | Done | Tickets | 0.7M | no | Not possible to send another reply after removing th |
| 69526 | Done | Documents | 0.6M | no | Save button remains disabled after changing internal |
| 66887 | Done | Documents | 0.5M | yes | Message card showing and disappearing when navigatin |
| 62530 | Done | Tickets | 0.2M | yes | Send as: Duplicate choice in dropdown |
| 60904 | Done | Tickets | 0.0M | no | Documents, MyAccount: Make it possible for external  |
| 71432 | Test in TST | Documents | 0.0M | no | Not Possible to upload documents |

### Caveats

- Sessions carrying no ticket number are excluded above and are the largest hole: Tickets 2,103M over 452 sessions (52% of the repo); Documents 834M over 204 sessions (62% of the repo).
- 33 of 84 candidate ids are not ADO work items at all (132M). The `[67]\d{4}` regex matches any five-digit number, and every candidate above 71566 is nonexistent.
- 585M sits on 7 items still in `Approved` / `New` / `Refinement`, which may be board state lagging real work rather than unstarted work.
- ADO states are a snapshot in `out/ado-states.csv`. Token numbers refresh on every run; the states do not.

## Superseded: merges to master (PRDPF5DFZH6)

_Kept for the record only. Master is not the delivery gate in these repos, and the author filter misses agent commits. Do not quote these numbers; see the delivery section above._

### Tickets

Main branch `origin/master`, author filter `thong.huynh.minh@aspia.se`, cutoff 2026-08-27.

| Era | Weeks | Merged tickets | Merged/week | Sessions (tstack) | Tokens (M) | Tokens per merged ticket (M) |
|---|---|---|---|---|---|---|
| before | 12.4 | 3 | 0.2 | 160 (0) | 365 | 121.5 |
| after | 10.6 | 4 | 0.4 | 585 (230) | 3667 | 916.7 |

Merged tickets that have agent sessions (lead = first session to merge):

| Group | Tickets | Median tokens (M) | Median lead (days) |
|---|---|---|---|
| after, with tstack | 4 | 40.8 | 12.5 |
| before, main chat only | 2 | 6.6 | 27.0 |

Tickets with sessions but no merge found: 45 (tokens 1383M).

### Documents

Main branch `origin/master`, author filter `thong.huynh.minh@aspia.se`, cutoff 2026-08-27.

| Era | Weeks | Merged tickets | Merged/week | Sessions (tstack) | Tokens (M) | Tokens per merged ticket (M) |
|---|---|---|---|---|---|---|
| before | 12.4 | 1 | 0.1 | 56 (0) | 191 | 191.4 |
| after | 10.6 | 0 | 0.0 | 226 (155) | 1162 | - |

Merged tickets that have agent sessions (lead = first session to merge):

| Group | Tickets | Median tokens (M) | Median lead (days) |
|---|---|---|---|

Tickets with sessions but no merge found: 35 (tokens 520M).


## Superseded: merges to master (all-authors-PRDPF5DFZH6)

_Kept for the record only. Master is not the delivery gate in these repos, and the author filter misses agent commits. Do not quote these numbers; see the delivery section above._

### Tickets

Main branch `origin/master`, author filter `all`, cutoff 2026-08-27.

| Era | Weeks | Merged tickets | Merged/week | Sessions (tstack) | Tokens (M) | Tokens per merged ticket (M) |
|---|---|---|---|---|---|---|
| before | 12.4 | 20 | 1.6 | 160 (0) | 365 | 18.2 |
| after | 10.6 | 18 | 1.7 | 585 (230) | 3667 | 203.7 |

Merged tickets that have agent sessions (lead = first session to merge):

| Group | Tickets | Median tokens (M) | Median lead (days) |
|---|---|---|---|
| after, main chat only | 1 | 2.3 | 117.0 |
| after, with tstack | 4 | 40.8 | 12.5 |
| before, main chat only | 2 | 6.6 | 27.0 |

Tickets with sessions but no merge found: 44 (tokens 1381M).

### Documents

Main branch `origin/master`, author filter `all`, cutoff 2026-08-27.

| Era | Weeks | Merged tickets | Merged/week | Sessions (tstack) | Tokens (M) | Tokens per merged ticket (M) |
|---|---|---|---|---|---|---|
| before | 12.4 | 7 | 0.6 | 56 (0) | 191 | 27.3 |
| after | 10.6 | 9 | 0.9 | 226 (155) | 1162 | 129.1 |

Merged tickets that have agent sessions (lead = first session to merge):

| Group | Tickets | Median tokens (M) | Median lead (days) |
|---|---|---|---|
| after, with tstack | 1 | 124.6 | 90.0 |

Tickets with sessions but no merge found: 34 (tokens 395M).



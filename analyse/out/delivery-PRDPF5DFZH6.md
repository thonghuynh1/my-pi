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

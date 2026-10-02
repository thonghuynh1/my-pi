# Clearer assistant responses: an ASD-STE100 session review

Reviewed: 2 October 2026.

## Conclusion

The most useful change is not simply shorter answers. It is **making distinctions explicit before giving an answer or an action**:

- Existing behavior versus a proposed feature.
- A configured service versus a working service.
- Implementation coverage versus test coverage.
- Restarting a terminal versus restarting its background host.
- An expected test-control result versus a failure.

The sample contains explicit requests for clearer explanations in S03 and S06. In S10, the user restated an incorrect restart assumption after a qualified affirmative answer. These examples support the priorities below. They do not prove that a rewrite would have prevented a follow-up.

## Scope and sampling

- **Window:** 25 September 2026, 09:24:59 UTC, through 2 October 2026, 09:24:59 UTC; the end is exclusive.
- **Source:** the local aiNho imported memory store, accessed through `aiNho sql`. This is not a claim of complete coverage of every machine or unimported session.
- **Interactive session:** at least two human user messages and two nonempty assistant responses. System instructions, expanded skill prompts, background-job/subagent notices, tstack wake notices, and automatic Side Conversation publication envelopes do not count as human messages.
- **Population:** 113 initial candidates; 108 after the first interactivity screen; 98 after excluding additional automated notices. No older-starting session had enough user and assistant activity inside the window to qualify.
- **Random selection:** Python `random.Random(18328800780114397707).sample(frame, 10)`, without replacement. The frame was the 108 first-screen candidates, sorted by `(source, source_session_id)`. The complete draw was accepted only if all ten passed the final human-interactivity screen. The first draw passed; no sessions were replaced. This is a uniform sample conditional on final eligibility, not a selection of the worst conversations.
- **Reviewed material:** all nonempty assistant prose and human messages in the ten selected sessions within the window: **178 assistant responses and 99 human messages**. Tool-only messages, hidden reasoning, and injected context were not evaluated as assistant prose. Automated notices were not treated as evidence of user confusion.
- **Analysis:** qualitative review of all ten transcripts. Three parallel reviewers examined separate subsets; the parent checked the principal quoted examples and their ordering against exported turns.

All ten randomly selected sessions were Pi sessions. The eligible population was not restricted to Pi.

| Sample | Start date, UTC | Human messages | Subject |
|---|---|---:|---|
| S01 | 2026-10-02 | 2 | Email-signature PR review |
| S02 | 2026-10-01 | 4 | Connected-company search PR review |
| S03 | 2026-09-29 | 5 | Report Notice publication and live verification |
| S04 | 2026-09-26 | 11 | Session retrieval and retrieval budgets |
| S05 | 2026-10-01 | 2 | Cross-computer report delivery |
| S06 | 2026-09-30 | 53 | Side Conversation lifecycle and native resume |
| S07 | 2026-09-28 | 3 | Finding Azure account information and signing out |
| S08 | 2026-09-28 | 4 | Migrated attachment-picker behavior |
| S09 | 2026-09-30 | 9 | Global MCP configuration |
| S10 | 2026-10-01 | 6 | Reloading the tstack host |

Session IDs, queries, the random seed, and the sampling frame are retained outside the repository in `~/.agent-memory/reviews/2026-10-02-asd-ste100/ste-sample-manifest.json`. Selected transcript exports are retained beside it. The report includes only selected excerpts; it omits account addresses and absolute personal workspace paths.

## Standard and limits

The reference is **ASD-STE100 Issue 9, January 2025**, dated 15 January 2025. STE was designed for technical documentation, not general conversation. The official FAQ permits applying principles such as short sentences and active voice elsewhere.

This is an **STE-informed conversational guide**, not a compliance audit. The rewrites were not checked against the complete STE dictionary. Code, exact commands, error strings, and product identifiers must keep their exact spelling.

The distinction matters: STE's word limits and instruction rules are standard requirements in their respective writing modes. Our status labels, explanatory glosses, and answer-first ordering are conversational adaptations.

## Rules to use

| Priority | Verified STE basis, paraphrased | Application to assistant responses | Sample evidence |
|---|---|---|---|
| 1 | **1.11; 9.4:** keep technical names and wording consistent. | Name the exact object. Do not use “agent” for both retrieval and answering, or blur captain, sink, and host. Use scope labels consistently. | S01, S02, S04, S10 |
| 2 | **4.1:** make sentences clear. **1.10:** do not use regional, slang, or jargon words as technical nouns. | Explain unfamiliar test terms and status tokens when first used. Preserve identifiers such as `NO_MARKER`, but explain their meaning. Avoid unexplained compressed command sequences. This explanatory-gloss policy is our adaptation. | S03, S06 |
| 3 | **5.4:** put a required condition before its instruction. | State prerequisites, permission, and shared-resource risks before telling the user to restart, stop, or delete something. | S07, S09, S10 |
| 4 | **5.2; 5.3:** use one instruction per sentence, except simultaneous actions; use command form for instructions. | Give sequential actions separate numbered steps. Put optional actions behind an explicit “If…” condition. | S05, S07, S08 |
| 5 | **3.6:** use active voice; descriptive passive voice is allowed when the actor is unknown. **6.4–6.6:** group related information; use one topic per paragraph and at most six sentences. | Identify who did what. Separate **Changed**, **Verified**, **Not verified**, and **Next action**. Mark proposals as proposals. These labels are our adaptation, not STE-prescribed labels. | S01, S02, S06, S09, S10 |
| 6 | **4.1; 4.2; 5.1; 6.3:** use clear, complete sentences; do not omit words or use contractions to shorten them. Procedural sentences have a 20-word limit; descriptive sentences have a 25-word limit. | Use 20/25 words as chat editing targets, not as a reason to delete necessary context. Replace long, multi-purpose sentences with complete sentences. Avoid “Mostly yes” when the important distinction comes later. | S02, S03, S08, S09, S10 |

Avoiding all idioms is a useful local policy, but it is not an exact standalone STE rule. Similarly, “one word, one meaning” is not an absolute ban on every alternative meaning: STE rules 1.2 and 1.3 require the dictionary-approved part of speech and meaning for each entry.

## Findings from all ten sessions

Quoted fragments are original assistant prose. Rewrites are proposed alternatives, not historical messages.

### S01 — Label implementation and test coverage separately

**Before, assistant turn 30:** “**Gaps**: None — all stated requirements are covered.” The report also recommended a test for save-failure recovery.

**Rewrite:**

> Implementation: I found no missing acceptance-criteria behavior. Test coverage: save-failure recovery remains unverified. Add a test that checks whether the modal preserves edits after a failed save.

**Why:** “Gaps” was too broad. It could make the missing verification disappear under a positive summary. This is an ambiguity in scope, not proof that the implementation was defective.

**Evidence:** No later user message showed confusion about this summary. Expected benefit only. Rules 1.11, 9.4, and the status-label adaptation.

### S02 — Separate today's decision from a future recommendation

**Before, assistant turn 36:** “No action required in this PR — the method is coherent and well-tested (368 lines of pager tests). Flagging it as a watchpoint: if future work adds more loading modes (e.g. debounced typing, server-push refresh), consider splitting `Load` into a state machine or extracting the step-back-from-empty-page retry into a named method.”

**Rewrite:**

> No change is needed in this PR. If future work adds loading modes, consider splitting `Load` into smaller methods or a state machine.

**Why:** The present decision no longer competes with a long future-work instruction. A test line count is also not necessary to understand the recommendation.

**Evidence:** No clarification request followed. Expected benefit only. Rules 4.1, 5.4, and 6.3.

### S03 — Translate verification shorthand into behavior

**Before, assistant turn 50:** “**Proved live:** publish → Report Notice (dedicated inbox) → get-one → explicit ack (report kept) · no team dispatch · clean disposable worktree”

**Rewrite:**

> The live test published a report and created a Report Notice in the captain's inbox. The test retrieved the report and acknowledged the notice. Acknowledgement kept the report. Publishing did not dispatch a team. The test cleaned up its disposable worktree.

**Why:** The reader can understand what was proved without decoding `get-one`, `ack`, arrows, and separators.

**Evidence:** The next human message, turn 51, asked: “could you translate the json so human can understand more clear”. This is direct evidence of a need for a more readable explanation, not proof that this one sentence caused it. Rules 4.1, 3.6, and the explanatory-gloss adaptation.

### S04 — Identify which agent reads the evidence

**Before, assistant turn 15:** “Yes—the agent should retrieve evidence from sessions, not load sessions as context.”

**Rewrite:**

> The retrieval process should search the selected sessions. The answering agent should receive relevant passages, not complete transcripts.

**Why:** “The agent” concealed two roles. Naming the roles makes the context boundary easier to discuss and implement.

**Evidence:** The user continued making design decisions without requesting clarification about this sentence. Expected benefit only. Rules 1.11, 3.6, and 4.1.

### S05 — Give each operational action its own step

**Before, assistant turn 175:** “Apply the changes on the other computer, restart its tstack host, and open a fresh Side Conversation. Old publication cards are unchanged.”

**Rewrite:**

> To use the fix on the other computer:
> 1. Apply the changes.
> 2. Restart that computer's tstack host.
> 3. Open a fresh Side Conversation.
>
> Existing publication cards remain unchanged.

**Why:** Three sequential actions are easier to execute and check as separate steps.

**Evidence:** No later clarification showed difficulty with the original. Expected benefit only. Rules 5.1–5.3.

**Keep:** Assistant turn 163 explicitly limited the proof to inbox delivery, excluding agent approval and captain-model presentation. That distinction was already useful.

### S06 — Mark proposals and explain control results

**Before, assistant turn 70:** “The prototype’s **Sleep** button puts only the selected conversation to sleep.”

**Rewrite:**

> Sleep is a proposed button in the mockup, not an existing tstack control. The mockup changes fake data; it does not control terminals. Live testing has verified workspace sleep only, which may affect other tabs.

**Evidence:** In turn 71, the user pointed out that there was no Sleep button and asked what the prototype actually did. In turn 72, the assistant acknowledged: “I should have made that clearer.” This is direct evidence of an unclear proposal-versus-product boundary.

**Before, assistant turn 120:** “A fresh-session control returned `NO_MARKER`.”

**Rewrite:**

> A brand-new Pi session returned `NO_MARKER`: it did not remember the earlier marker. That was the expected control result. The resumed session remembered the exact marker.

**Evidence:** In turn 121, the user asked what `NO_MARKER` meant. The original needed a plain-language gloss.

**Why:** Both rewrites explain meaning and status before presenting a technical conclusion. Rules 1.11, 4.1, and the proposal/status adaptations. These are the strongest examples in the sample.

### S07 — Preserve the distinction between required and optional actions

**Before, assistant turn 17:** The response supplied `az logout`, an optional `az account clear`, and a verification command across separate prose blocks.

**Rewrite:**

> 1. Run `az logout` to sign out of Azure CLI.
> 2. If you also want to remove cached account and subscription data, run `az account clear`.
> 3. Run `az account show` to check. It should report that you are not logged in.

**Why:** The sequence and optional cache removal remain explicit.

**Evidence:** No later clarification was recorded. This is a small usability improvement, not a significant failure. Rules 5.2–5.4. The original answer already explained the optional action adequately.

### S08 — Remove process-script clutter from the user-facing answer

**Before, assistant turn 24:** “A debug or instrumentation protocol that says to ask the user does not override this; you drive the instrumented runtime.” The response included a long reproduction-policy checklist.

**Rewrite:**

> I will reproduce the attachment-picker behavior in the migrated Tickets form. Then I will identify which component needs the upstream change. If I cannot reach the test surface, I will explain the specific limitation.

**Why:** The user needs the investigation plan, not the full internal policy. The rewrite separates actions and preserves the access limitation.

**Evidence:** Later compiler and lint requests were task extensions, not evidence of confusion about this prose. Expected benefit only. Rules 3.6, 4.1, 6.5, and the adaptation to omit irrelevant process detail.

### S09 — Put the prerequisite before the restart instruction

**Before, assistant turn 62:** “Restart Pi to load it. The `cua-driver` executable must be installed and available on your `PATH`.”

**Rewrite:**

> I added the MCP configuration. Startup is not yet verified. Before restarting Pi, confirm that Pi can find the installed `cua-driver` executable on its `PATH`.

**Why:** Configuration completion is not the same as startup verification. The dependency now appears before the action.

**Evidence:** In turn 65, the user reported `write EPIPE`; turn 72 attributed it to the executable path and described a configuration fix. Better wording could expose the prerequisite earlier, but wording alone would not fix the configuration. This is a dependency-order example, not an STE-caused technical failure. Rules 5.4 and the status-label adaptation.

### S10 — Lead with the restart boundary, not a qualified “yes”

**Before, assistant turn 113:** “Mostly yes, with one caveat about picking up new tstack code.” The detailed distinction appeared later in the answer.

**Rewrite:**

> Closing the captain closes the sink tab, not the host process. Reopening the captain reloads extension code, but not host code. If no other project has active work, restart the host to load changed host code.

**Why:** The crucial distinction is the answer, not a caveat. The rewrite keeps the shared-host condition visible.

**Evidence:** In turn 114, the user restated the assumption that closing the captain and starting another would load the new code. Turn 115 had to correct it. The original already contained the explanation; its opening and ordering made the wrong conclusion easier to retain. Rules 1.11, 4.1, 5.4, and the answer-first adaptation.

## What STE will not fix

- Incorrect technical claims, missing tests, or unverified dependencies require engineering work, not just editing.
- Asking for an explanation can be normal learning. It is not automatically a failed conversation.
- A hypothetical rewrite is not an experimentally measured improvement.
- The sample is small and uneven: S06 contains 53 of the 99 human messages. It cannot estimate a general confusion rate.
- Formal dictionary enforcement could make ordinary conversation less natural. Prioritize clarity without changing exact identifiers or deleting necessary qualifications.

## Reusable response checklist

Before sending a technical answer:

1. State the answer or important boundary first.
2. Name the actor and object; keep their names consistent.
3. Explain unfamiliar terms and test-result tokens.
4. Distinguish a proposal, a completed change, and a verified result.
5. Put prerequisites and safety conditions before actions.
6. Give each sequential action a separate step.
7. Keep each paragraph on one topic. Split long sentences without turning them into fragments.
8. State what remains unverified. Do not let a positive summary conceal it.

For a change report, use this structure when it helps:

> **Changed:** What I changed.
>
> **Verified:** What the evidence establishes.
>
> **Not verified:** What the evidence does not establish.
>
> **Next action:** The prerequisite, followed by the action.

These are recommended writing practices. This review does not change Pi's configuration, system instructions, or repository-wide agent policy.

## Sources

- [Official STE overview](https://www.asd-ste100.org/about_STE.html)
- [Official FAQ: scope and use outside technical documentation](https://www.asd-ste100.org/STE_faq.html)
- [Official downloads and Issue 9 request](https://www.asd-ste100.org/STE_downloads.html)
- ASD-STE100, Issue 9: Part 1, sections 1, 3–6, and 9. Rule numbers were checked against the Issue 9 text. Requirements above are paraphrased, not a reproduction of the standard.

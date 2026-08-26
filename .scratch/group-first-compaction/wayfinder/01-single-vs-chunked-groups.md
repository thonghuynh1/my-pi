# Should planFoldsToCap be replaced with a single group or multiple chunked groups?

Type: grilling
Status: resolved

## Question

`planFoldsToCap` currently emits N individual fold/replace commands (one per block) until `projected <= cap`. The replacement should batch these into groups. But which shape?

**Option A — Single group:** Collect all eligible candidates in `[0, preGroupFromIndex)`, create one group. Simple, minimal cache breaks, but the group digest could be enormous (700+ blocks → huge summary).

**Option B — Chunked groups:** Use `sliceSegmentIntoGroups` (already exists) to slice candidates into ~15k-token chunks, producing multiple smaller groups. More cache breaks but bounded digest sizes. Consistent with the rollover group sizing.

**Option C — Adaptive:** One group if total tokens < threshold (e.g. 50k), chunked if larger.

The decision affects digest quality (LLM summarization of grouped content), cache-break frequency, and plan size.

## Answer

**Option B — Chunked ~15k groups.** Use `DEFAULT_PRE_GROUP_TOKENS` (15k, scaling to 30k via `MAX_DYNAMIC_PRE_GROUP_TOKENS`) as the chunk boundary. Accept cache breaks as a good trade-off for bounded digest quality and design consistency with the legacy path. The existing `sliceSegmentIntoGroups` already implements this slicing logic.

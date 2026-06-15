# Scout Dispatch

When `grill_decide` returns `call-now`, its response includes a `scoutPrompts` object keyed by profile name. Each value is a ready-to-use prompt.

For each profile in `selectedScoutProfiles`, call `subagent` with:
- type: "explore"
- task: the value from `scoutPrompts[profileName]` verbatim

Do not rewrite or summarize the prompt. Pass it as-is. The prompt already contains the profile-specific investigation protocol, decision context, checkpoint, anchors, and required verdict format.

After each scout returns, call `grill_record_scout` with the gate ID, profile name, and full output.

# Make Pre-Group a conductor-owned plan region

`MyCustomizeConductor` will declare the complete current Pre-Group Interval as first-class metadata on each revisioned conductor plan, applied atomically with that plan’s commands. The store—not display telemetry—will enforce the interval’s no-fold/no-group contract and expose its exact membership to the UI; this avoids stale status controlling behavior and avoids a separate incremental reserve/release state machine.

## Consequences

Legacy plans without Pre-Group metadata own no region. Empty membership, detach, or conductor replacement clears ownership; rollover is one plan containing empty next membership and the rollover group command.

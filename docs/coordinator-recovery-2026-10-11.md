# Latest long-running Coordinator recovery audit

Run: `chat-c680915b79091c4f10992a2c1af71ec2fcd93b2e`.
Lead conversation: `01a124f1-711e-7933-94a3-60728a6ad165`.
Evidence: read-only Coordinator run listing, the local authoritative ledger,
and the editor's provider-backed canonical transcript. All times below are UTC.
The production run was not mutated, resumed, stopped, or reassigned by this audit.

## What happened

| Time on October 10 | Evidence | Consequence |
| --- | --- | --- |
| 08:33 | Run created with three Codex teammates. | All workers depended on the same provider account. |
| 09:03:11–09:03:20 | All three `agent.blocked` events carry `failureClass: rate_limited` and the same usage-limit message. | No configured alternative could execute the work. Retrying immediately would not resolve account quota exhaustion. |
| 21:41–21:42 | Lead sent recovery instructions and released tasks 5, 6 and 7. The scheduler reclaimed them. | Releasing work changed ownership but retained uncertain dispatch reservations. Mail and claims did not prove a resumed provider turn. |
| 21:43–21:49 | Provider activity resumed; task 6 completed at 21:47:04. The editor published its final verification finding at 21:48:29. | Saved implementation and verification survived. The editor transcript ends after that finding and a new user steering message; it contains no final task-completion call. This evidence does not establish the exact runtime cause of the subsequent stopped execution. |
| 21:55:46 | Lead released task 7 after observing no live editor turn. | The original work became pending. |
| 21:55:49 | `agent-2` (`tui-worker-memory`) claimed task 7. | Its old dispatch reservation still referenced task 6, created at 08:50:28. Dispatch refused to start the new task. |
| 22:01:53–22:01:54 | Lead released task 7 again for healthy `tui-workflows`; `agent-2` immediately reclaimed it. | The scheduler repeated the stalled assignment. The healthy worker's claim was rejected. |
| 22:04 | Lead completed a separate takeover-verification task 9. | Task 7 remained claimed by inactive `agent-2`, and dependent task 8 remained pending despite the verification being done. |

The ledger still contains the old `agent-2` task-6 reservation and `agent-3`
task-7 reservation. Task 7's claim generation is 4. The retained markers are
execution uncertainty records, not proof of a live native turn.

## Recovery defects and implemented corrections

1. `sweepIdleTeammates` could claim work before discovering that
   `dispatchTeammateWork` would reject its retained reservation. The atomic
   `claimTaskSync` path now excludes an agent with a reservation and no locally
   observed turn. Explicit claims from an observed live turn still work.
   The actionable digest follows the same gate, and claim rejection explains
   the owning-host inspection requirement.
2. `readSettledInteractiveExecutions` hid a completed reservation once another
   task was assigned to the agent. The old reservation can now be explicitly
   acknowledged when the newer task is still claimed by that agent. It clears
   only the old marker and retains the newer task, claim generation and locks.
3. Releasing uncertain work left a marker with no owned task. Recovery offered
   resume, which necessarily failed. Relinquished executions now offer explicit
   acknowledgement. This retires their reservation without submitting a turn
   or altering the released task or another participant's subsequent claim.

Acknowledgement remains blocked by a live local turn, an in-process dispatch,
foreign host ownership, or currently owned unfinished execution. Maintenance
does not clear uncertain reservations automatically. Provider/model pins,
human approvals and native permission gates remain authoritative.

For the existing stranded state, the owning host can inspect and acknowledge
`tui-worker-memory`'s old completed execution in the recovery overview. Its
current task-7 claim is preserved; ordinary maintenance can then dispatch the
saved conversation. To hand it to a healthy teammate instead, release task 7
and leave the former worker's uncertain execution unacknowledged until the
healthy teammate has claimed the work. Acknowledgement never submits a turn
itself; an already queued claim may subsequently be scheduled by maintenance.
These are available recovery paths, not actions performed on this run.

## Verification

`bun scripts/coordRecoveryClaimSmoke.ts` uses isolated ledgers and scripted
native transport across separate processes. It reproduces a new claim behind
an old completed reservation, the release/reclaim trap, healthy handoff,
relinquished acknowledgement and persisted reopen. It also verifies that
owned unfinished execution cannot be acknowledged and that acknowledgement
does not itself submit work. The fixture fails on the pre-change source at
the stranded-marker assertion and passes on the changed source.

Existing `coordTeamRecoverySmoke`, `coordInteractiveRecoverySmoke`,
`coordInteractiveHostsSmoke` and `coordAutomaticDelegationSmoke` pass.
OpenTUI type checking passes. Full TypeScript checking still reports the four
existing legacy Ink `WritableStream.rows/columns` errors. Fixture coverage
does not establish live-provider restart success or long-duration throughput.

## Remaining improvements

- Persist structured provider cooldown/reset evidence, and distinguish an
  account-quota pause from a human question in recovery controls. Do not
  automatically replay a turn that may already have executed tools.
- Give execution reservations independent attempt identity, timestamps,
  provider-instance identity and claim generation. A task ID alone is not a
  sufficient identity after release and reclaim of that same task.
- Expose authenticated lead recovery inspection/acknowledgement through MCP,
  preserving host ownership. In this run the lead had release/mail tools but
  needed the owning UI to reconcile native execution.
- Capture the reason a native turn stops after publishing a finding but before
  its receipt. The latest editor transcript establishes the incomplete receipt,
  but not whether the native turn was interrupted, disconnected or otherwise
  terminated. Do not convert a finding into a completion receipt automatically.

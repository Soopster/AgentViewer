# Herdr techniques applied to Coordinator

Source inspection: local `/Users/lukeryan/Documents/src/herdr`, September 8, 2026.
This is an implementation comparison, not a comparative throughput benchmark.

Herdr's `src/api/wait.rs` separates prompt submission, observed activity, and
settled state. It captures an event sequence before submission, checks the
target's identity, and preserves that sequence through both waits so short
transitions and lifecycle changes are not lost. Its skill distinguishes blocked,
unknown, working, and ready states, and warns that timeout does not prove a
prompt was never delivered. The server owns processes and observation; a model
does not need to spend turns polling terminal output.

Coordinator already has durable task ownership, typed mail, server-side waits,
provider identities, and supervisor-owned processes. The corresponding changes
in this checkout are:

- Blocked and approval-waiting ownership does not trigger model turns. Mail or
  approval can wake the worker; another claimable lane cannot override an owned
  blocked task. Restarted supervisors apply the same live-state gate before
  their first provider turn; fresh participants retain their bootstrap turn.
- Three successive successful turns with the same actionable digest trigger
  supervisor pacing: 1 second, doubling up to 30 seconds. A changed digest wakes
  promptly. Mail/reply-required work bypasses pacing. Heartbeat/cursor noise does
  not bypass it. Work remains owned and resumes after the bounded delay.
- Coordinator observation failures retry the status/wait operation without
  starting another model turn. Reconnection preserves the pacing deadline; a
  terminal run observed after an outage exits without invoking the provider.
- Immediate non-actionable event responses are throttled in blocked and idle
  states as well as paced states, preventing heartbeat-driven polling loops.
- Native CLI completion waits for stdout/stderr closure and consumes the final
  JSON frame even without a newline. A final provider error cannot be hidden by
  an otherwise successful exit code.
- Keyed mutations retain durable attempt records. After an uncertain outcome,
  agents reconcile durable state rather than blindly resubmitting effects.
- Worker listings distinguish process lifecycle from observed activity.
  `coord workers --activity blocked` and `--activity awaiting_approval` locate
  live workers needing attention; JSON includes the reason, task, and observation
  timestamp. Provider turns report working, observation failures report unknown,
  and stopped workers clear live activity.
- Compact shared tool definitions and conditional skill references keep the
  operating instructions consistent across provider entry points.

`scripts/coordWorkerSchedulingSmoke.mjs` checks blocked/approval waits, repeated
unchanged turns, wake-on-mail, and bounded continuation using actual supervisor
processes, including failures during immediate reads and long polls and a run
that completes during the outage. Restart fixtures verify zero provider turns
until mail or approval; a heartbeat flood checks bounded poll frequency.
`scripts/coordWorkerSmoke.mjs` checks an unterminated final error frame
from a provider that exits successfully, alongside recovery and shutdown cases.
The full `mcp:smoke` suite covers transport replay and provider adapter contracts.

Pacing is deliberately not a proof of no progress: file edits can advance while
the board digest remains unchanged. It limits turn frequency without declaring
failure or automatically handing off healthy work. It does not bound total model
spend or certify parity with Herdr. Native provider activity detection and live
long-duration comparisons remain separate validation work; Herdr's terminal
state classifier and fixed five-second activity gate cannot simply be copied
into structured SDK/CLI transports with different startup behavior.

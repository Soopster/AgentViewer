// Stable tool identities the MCP bridge publishes into AHP active-client
// capability state. Keep this list exact: AHP ToolDefinition names are
// callable identities, so a wildcard such as `coord_*` is not valid there.
export const COORDINATOR_MCP_TOOL_NAMES = Object.freeze([
  'coord_list_runs',
  'coord_create_run',
  'coord_preview_playbook',
  'coord_list_playbooks',
  'coord_save_playbook',
  'coord_join_run',
  'coord_resume',
  'coord_status',
  'coord_wait',
  'coord_await_run',
  'coord_create_task',
  'coord_claim_task',
  'coord_release_task',
  'coord_leave_run',
  'coord_read_inbox',
  'coord_send_message',
  'coord_handoff_task',
  'coord_request_locks',
  'coord_progress',
  'coord_publish_finding',
  'coord_query_context',
  'coord_remember',
  'coord_save_role',
  'coord_list_roles',
  'coord_submit_plan',
  'coord_review_plan',
  'coord_review_phase',
  'coord_review_run',
  'coord_resolve_decision',
  'coord_promote_learning',
  'coord_cancel_turn',
  'coord_spawn_teammate',
  'coord_complete_task',
  'coord_fail_task',
  'coord_finalize_run',
])

// Shared by the MCP bridge and AHP client. Keep setup mutations out: create/join
// allocate participant credentials and have no participant-scoped replay key.
export const COORDINATOR_READ_ACTIONS = Object.freeze([
  'list_playbooks', 'list_roles', 'list_runs', 'preview_playbook',
  'query_context', 'resume', 'status', 'wait',
])
export const COORDINATOR_KEYED_ACTIONS = Object.freeze([
  'cancel_turn', 'claim_task', 'complete_task', 'create_task', 'fail_task',
  'finalize_run', 'finding', 'handoff_task', 'leave_run', 'progress',
  'promote_learning', 'read_inbox', 'release_task', 'remember', 'request_locks',
  'resolve_decision', 'review_phase', 'review_plan', 'review_run', 'save_playbook',
  'save_role', 'send_message', 'spawn_teammate', 'submit_plan',
])

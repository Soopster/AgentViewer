// Stable tool identities the MCP bridge publishes into AHP active-client
// capability state. Keep this list exact: AHP ToolDefinition names are
// callable identities, so a wildcard such as `coord_*` is not valid there.
export const COORDINATOR_MCP_TOOL_NAMES = Object.freeze([
  'coord_list_runs',
  'coord_create_run',
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
  'coord_read_inbox',
  'coord_send_message',
  'coord_handoff_task',
  'coord_request_locks',
  'coord_progress',
  'coord_publish_finding',
  'coord_submit_plan',
  'coord_review_plan',
  'coord_complete_task',
  'coord_fail_task',
  'coord_finalize_run',
])

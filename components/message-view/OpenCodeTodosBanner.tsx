'use client'
import { memo, useState } from 'react'
import type { OpenCodeTodo } from './types'

// Pinned todo list — mirrors opencode-web's session-level todos widget.
// Renders status icons and counts inline so users see live progress as
// the agent flips each item from `pending` → `in_progress` → `completed`.
export const OpenCodeTodosBanner = memo(function OpenCodeTodosBanner({ todos }: { todos: OpenCodeTodo[]} ) {
  const [collapsed, setCollapsed] = useState(false)
  const completedCount = todos.filter((todo) => todo.status === 'completed').length
  const inProgress = todos.find((todo) => todo.status === 'in_progress')

  return (
    <div
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'rgba(56,217,245,0.04)',
        padding: '8px 28px',
        flexShrink: 0,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      }}
    >
      <button
        type="button"
        className="av-hover-control"
        onClick={() => setCollapsed((value) => !value)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'transparent',
          border: 0,
          padding: 0,
          color: 'var(--text-2)',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            borderRadius: 4,
            background: 'rgba(56,217,245,0.12)',
            color: 'var(--cyan)',
            fontSize: 10,
            letterSpacing: '0.06em',
          }}
          aria-hidden="true"
        >
          {collapsed ? '+' : '−'}
        </span>
        <span style={{ fontWeight: 600, letterSpacing: '0.08em', color: 'var(--cyan)' }}>TODOS</span>
        <span style={{ color: 'var(--text-3)' }}>
          {completedCount}/{todos.length}
          {inProgress ? ` · ${inProgress.content}` : ''}
        </span>
      </button>
      {!collapsed && (
        <ul style={{ listStyle: 'none', margin: '8px 0 0 28px', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {todos.map((todo) => (
            <li
              key={todo.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                color: todo.status === 'completed' ? 'var(--text-3)' : 'var(--text)',
                textDecoration: todo.status === 'completed' ? 'line-through' : 'none',
                opacity: todo.status === 'cancelled' ? 0.6 : 1,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flexShrink: 0,
                  width: 12,
                  marginTop: 1,
                  color: todoStatusColor(todo.status),
                }}
              >
                {todoStatusGlyph(todo.status)}
              </span>
              <span style={{ flex: 1 }}>{todo.content}</span>
              {todo.priority && todo.priority !== 'medium' && (
                <span
                  style={{
                    fontSize: 11,
                    letterSpacing: '0.02em',
                    color: 'var(--text-3)',
                    textTransform: 'capitalize',
                    flexShrink: 0,
                  }}
                >
                  {todo.priority}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})
function todoStatusGlyph(status: string): string {
  if (status === 'completed') return '✓'
  if (status === 'in_progress') return '●'
  if (status === 'cancelled') return '✗'
  return '○'
}
function todoStatusColor(status: string): string {
  if (status === 'completed') return 'var(--green)'
  if (status === 'in_progress') return 'var(--cyan)'
  if (status === 'cancelled') return 'var(--text-3)'
  return 'var(--text-3)'
}

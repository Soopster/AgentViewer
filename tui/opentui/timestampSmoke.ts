import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { formatTranscriptCards } from '../format'

if (process.env.TUI_TIMESTAMP_CHILD !== '1') {
  for (const TZ of ['UTC', 'Australia/Melbourne', 'America/New_York']) {
    for (const LANG of ['en_US.UTF-8', 'en_AU.UTF-8', 'de_DE.UTF-8']) {
      const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
        env: { ...process.env, TZ, LANG, TUI_TIMESTAMP_CHILD: '1' }, encoding: 'utf8', timeout: 30000,
      })
      assert.equal(result.status, 0, `${TZ}/${LANG}: ${result.stderr}`)
    }
  }
  console.log('Timestamp parity passed across 3 timezones and 3 locale environments')
} else {
  const timestamps = [
    undefined, '', 'invalid timestamp',
    '2026-01-01T00:00:00Z', '2026-01-01T23:59:59Z',
    '2026-03-08T06:59:59Z', '2026-03-08T07:00:00Z',
    '2026-04-04T15:59:59Z', '2026-04-04T16:00:00Z',
    '2026-11-01T05:59:59Z', '2026-11-01T06:00:00Z',
  ]
  const cards = formatTranscriptCards(timestamps.map((timestamp, i) => ({
    uuid: `timestamp-${i}`, role: 'user', timestamp, blocks: [{ type: 'text', text: 'Time boundary' }],
  })))
  for (let i = 0; i < timestamps.length; i++) {
    const value = timestamps[i]
    const parsed = value ? new Date(value) : null
    const expected = !parsed ? undefined : Number.isNaN(parsed.getTime()) ? ''
      : parsed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    assert.equal(cards[i].timestamp, expected, `${process.env.TZ}: ${value}`)
  }
}

import assert from 'node:assert/strict'
import { tidyTaskSummary as t } from '../format'
assert.equal(t(`Background command "python3 - &lt;&lt;'EOF'\np='a.ts'\ns=open(p).read()\nEOF" completed`), `Background command "python3 - <<'EOF'…" completed`)
assert.equal(t('Monitor "Wait for smokes" stream ended'), 'Monitor "Wait for smokes" stream ended')
assert.equal(t('a &amp; b'), 'a & b')
assert.equal(t('first\nsecond'), 'first…')
console.log('taskNoticeSmoke ok')

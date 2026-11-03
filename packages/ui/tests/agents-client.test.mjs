// Send to agent in the viewer, imported straight from the client TypeScript: the agents the session lists, the default choice, the
// picker's line, what a send carries and the toasts of its replies.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentAge, agentChoices, agentLabel, parseAgents, sendNotice, sendRequest } from '../src/agents.ts'
import { parseIdeRequest } from '../src/ide.ts'

const since = new Date(1_000_000).toISOString()
const list = parseAgents({
  agents: [{ client: 'c3', name: 'Claude Code', task: 'route USB', since, root: '/w' }, { client: 'c5', name: 'Codex', since }, { client: 7, name: 'bad' }, null],
})

test('agents: the malformed are left out, the last choice comes first, else one of its name', () => {
  assert.deepEqual(
    list.map(a => a.client),
    ['c3', 'c5'],
  )
  assert.deepEqual(parseAgents(null), [])
  assert.deepEqual(parseAgents({ agents: 'x' }), [])
  assert.deepEqual(
    agentChoices(list, { client: 'c5', name: 'Codex' }).map(a => a.client),
    ['c5', 'c3'],
  )
  assert.deepEqual(
    agentChoices(list, { client: 'c9', name: 'Codex' }).map(a => a.client),
    ['c5', 'c3'],
    'a new session of the same harness',
  )
  assert.deepEqual(
    agentChoices(list, null).map(a => a.client),
    ['c3', 'c5'],
  )
})

test('picker line: name, task or folder, and how long it has been attached', () => {
  assert.equal(agentLabel(list[0], 1_000_000 + 125_000), 'Claude Code · route USB · 2 min ago')
  assert.equal(agentLabel(list[1], 1_000_000 + 5_000), 'Codex · 5 s ago')
  assert.equal(agentAge(undefined, 0), '')
})

test('a send carries the members with the anchor first, the board and the target; replies are toasts', () => {
  assert.deepEqual(sendRequest('Main', null, { refs: ['R1', 'C2', 'U1'], anchor: 'C2' }), { board: 'Main', target: null, refs: ['C2', 'R1', 'U1'] })
  assert.deepEqual(sendRequest('Main', 'lite', { refs: ['net:VCC'], anchor: null }), { board: 'Main', target: 'lite', refs: ['net:VCC'] })
  assert.deepEqual(sendNotice({ id: 's.4', name: 'Codex' }), { text: 'Sent to Codex', err: false })
  assert.deepEqual(sendNotice({ id: 's.4', name: 'Codex', read: true }), { text: 'Read by Codex', err: false })
  assert.deepEqual(sendNotice({ id: 's.4', name: 'Codex', returned: true }), { text: 'Returned: Codex left before reading it', err: true })
  assert.deepEqual(sendNotice({ error: 'no agent is attached' }), { text: 'Cannot send: no agent is attached', err: true })
  assert.equal(sendNotice({}), null)
  assert.equal(parseIdeRequest({ type: 'pcbjs:send', board: 'Main', refs: ['R1'] }), null, 'a send goes out of the frame, never in')
})

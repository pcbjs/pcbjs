import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hostPaths, inputKey } from './installed-host/platform.mjs'

test('Linux test host uses its downloaded executable and current Node, not Mac paths', () => {
  assert.deepEqual(hostPaths({ platform: 'linux', code: '/tmp/code build/code', node: '/opt/node/bin/node' }), {
    code: '/tmp/code build/code', cli: '/tmp/code build/bin/code', node: '/opt/node/bin/node',
  })
  assert.throws(() => hostPaths({ platform: 'linux' }), /requires --code/)
})

test('Mac test host retains the app layout and supports a separate candidate CLI', () => {
  assert.equal(hostPaths({ platform: 'darwin' }).cli, '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code')
  assert.equal(hostPaths({ platform: 'darwin', code: '/tmp/Code.app/Contents/MacOS/Code', cli: '/tmp/custom-cli' }).cli, '/tmp/custom-cli')
})

test('native keyboard probes use Control on Linux, Command on Mac and Shift for redo', () => {
  for (const [platform, modifier] of [['linux', 2], ['darwin', 4]]) {
    assert.deepEqual(inputKey('z', { platform, command: true }), { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: modifier })
    assert.deepEqual(inputKey('z', { platform, command: true, shift: true }), { key: 'Z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: modifier | 8 })
    assert.equal(inputKey('p', { platform, command: true }).modifiers, modifier)
    assert.equal(inputKey('r', { platform }).modifiers, 0)
    assert.equal('nativeVirtualKeyCode' in inputKey('r', { platform }), false, 'do not send Mac scan codes to Linux')
  }
})

test('unsupported hosts fail explicitly rather than claiming headless coverage', () => {
  assert.throws(() => hostPaths({ platform: 'win32', code: 'C:/Code.exe' }), /supports macOS and Linux/)
})

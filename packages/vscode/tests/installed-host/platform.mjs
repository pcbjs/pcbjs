import { dirname, join } from 'node:path'

export function hostPaths({ platform = process.platform, code, cli, node = process.execPath } = {}) {
  if (!['darwin', 'linux'].includes(platform)) throw new Error('Installed-host acceptance supports macOS and Linux')
  const executable = code ?? (platform === 'darwin' ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : undefined)
  if (!executable) throw new Error('Linux acceptance requires --code /path/to/VSCode-linux-x64/code')
  return {
    code: executable,
    cli: cli ?? (platform === 'darwin' ? join(dirname(executable), '../Resources/app/bin/code') : join(dirname(executable), 'bin/code')),
    node,
  }
}

/** CDP uses Meta=4 and Control=2. Native scan codes are OS-specific. */
export function inputKey(letter, { platform = process.platform, command = false, shift = false } = {}) {
  const upper = letter.toUpperCase()
  return { key: shift ? upper : letter.toLowerCase(), code: `Key${upper}`, windowsVirtualKeyCode: upper.charCodeAt(0), modifiers: (command ? (platform === 'darwin' ? 4 : 2) : 0) | (shift ? 8 : 0) }
}

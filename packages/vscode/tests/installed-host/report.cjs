const fs = require('node:fs')

exports.writeJson = (file, value) => {
  const temp = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2))
    const deadline = Date.now() + 1000
    for (;;) {
      try {
        fs.renameSync(temp, file)
        break
      } catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || Date.now() >= deadline) throw error
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
      }
    }
  } finally {
    fs.rmSync(temp, { force: true })
  }
}

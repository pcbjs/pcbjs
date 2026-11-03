// A session transport for the tests: every request and notification kept in `sent` as [method, params], each request answered at
// once by `answer`, and `emit` an event as the session would send it.
export function fakeTransport(answer = () => null) {
  const sent = []
  const handlers = new Map()
  return {
    sent,
    request(method, params) {
      sent.push([method, params])
      return Promise.resolve(answer(method, params))
    },
    notify: (method, params) => sent.push([method, params]),
    on: (event, fn) => handlers.set(event, [...(handlers.get(event) ?? []), fn]),
    frames() {},
    closed() {},
    open() {},
    emit: (event, data) => (handlers.get(event) ?? []).forEach(fn => fn(data)),
  }
}

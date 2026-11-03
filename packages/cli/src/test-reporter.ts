// A node --test reporter beside `spec`: one JSON line per test that ends, for the results `--json` adds to the report.
interface TestEvent {
  type: string
  data: { name: string; file?: string; nesting: number; details?: { duration_ms?: number; type?: string; error?: { message?: string; cause?: { message?: string } } } }
}

export default async function* results(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  for await (const e of source) {
    if ((e.type !== 'test:pass' && e.type !== 'test:fail') || e.data.details?.type === 'suite') continue
    const err = e.data.details?.error
    yield JSON.stringify({
      name: e.data.name,
      file: e.data.file ?? null,
      ok: e.type === 'test:pass',
      ms: Math.round((e.data.details?.duration_ms ?? 0) * 10) / 10,
      ...(e.type === 'test:fail' ? { error: String(err?.cause?.message ?? err?.message ?? 'failed').split('\n')[0] } : {}),
    }) + '\n'
  }
}

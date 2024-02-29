import anyTest from 'ava'
import fs from 'node:fs'
import http from 'node:http'
import { Miniflare } from 'miniflare'
import { equals } from 'uint8arrays'
import * as Link from 'multiformats/link'

/**
 * @typedef {{ miniflare: Miniflare, gateway: http.Server, denylist: http.Server }} TestContext
 */

const test = /** @type {import('ava').TestFn<TestContext>} */ (anyTest)

const deniedCID = Link.parse('QmSDeYAe9mga6NdTozAZuyGL3Q1XjsLtvX28XFxJH8oPjq')

const fixture = {
  root: Link.parse('bafybeihiacwi6bzmkxpek7sn4tijg2fvusngcwxbbs53mvizacq2lcfhya'),
  data: fs.readFileSync('./test/fixtures/bagbaieraxocivmxnv4dgrishln4qbnq5xorm47ntduxqtqok6xkzhwiwteoa.car')
}

test.before(async t => {
  const gateway = http.createServer((req, res) => {
    res.write(fixture.data)
    res.end()
  })
  await new Promise(resolve => gateway.listen(resolve))
  t.context.gateway = gateway

  const denylist = http.createServer((req, res) => {
    if (req.url?.includes(deniedCID.toV1().toString())) {
      res.write('{}')
    } else {
      res.statusCode = 404
    }
    res.end()
  })
  await new Promise(resolve => denylist.listen(resolve))
  t.context.denylist = denylist

  t.context.miniflare = new Miniflare({
    bindings: {
      // @ts-expect-error
      GATEWAY_URL: `http://127.0.0.1:${gateway.address().port}`,
      // @ts-expect-error
      DENYLIST_API_URL: `http://127.0.0.1:${denylist.address().port}`
    },
    scriptPath: 'dist/worker.mjs',
    packagePath: true,
    wranglerConfigPath: true,
    // We don't want to rebuild our worker for each test, we're already doing
    // it once before we run all tests in package.json, so disable it here.
    // This will override the option in wrangler.toml.
    buildCommand: undefined,
    wranglerConfigEnv: 'test',
    modules: true
  })
})

test('should proxy CAR request to gateway', async t => {
  const res = await t.context.miniflare.dispatchFetch(`http://localhost:8787/ipfs/${fixture.root}?format=car`)
  if (!res.ok) t.fail(`unexpected response: ${await res.text()}`)

  const output = new Uint8Array(await res.arrayBuffer())
  t.true(equals(fixture.data, output))
})

test('should proxy RAW request to gateway', async t => {
  const res = await t.context.miniflare.dispatchFetch(`http://localhost:8787/ipfs/${fixture.root}?format=raw`)
  if (!res.ok) t.fail(`unexpected response: ${await res.text()}`)

  const output = new Uint8Array(await res.arrayBuffer())
  t.true(equals(fixture.data, output))
})

test('should only allow graph API', async t => {
  const res = await t.context.miniflare.dispatchFetch(`http://localhost:8787/ipfs/${fixture.root}`)
  if (res.ok) t.fail(`unexpected response: ${await res.text()}`)

  t.is(res.status, 406)
  const message = await res.text()
  t.true(message.includes('not acceptable'))
})

test('should deny access to certain CIDs', async t => {
  const res = await t.context.miniflare.dispatchFetch(`http://localhost:8787/ipfs/${deniedCID}`)
  if (res.ok) t.fail(`unexpected response: ${await res.text()}`)
  t.is(res.status, 410)
})

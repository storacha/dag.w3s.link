/* eslint-env worker */
import {
  withContext,
  withErrorHandler,
  withHttpGet,
  withParsedIpfsUrl,
  composeMiddleware
} from '@web3-storage/gateway-lib/middleware'
import { HttpError } from '@web3-storage/gateway-lib/util'
import { withDenylist, withCdnCache } from './middleware.js'

/**
 * @typedef {import('./bindings').Environment} Environment
 * @typedef {import('@web3-storage/gateway-lib').IpfsUrlContext} IpfsUrlContext
 * @typedef {import('@web3-storage/gateway-lib').DagulaContext} DagulaContext
 */

export default {
  /** @type {import('@web3-storage/gateway-lib').Handler<import('@web3-storage/gateway-lib').Context, import('./bindings').Environment>} */
  fetch (request, env, ctx) {
    const middleware = composeMiddleware(
      withErrorHandler,
      withHttpGet,
      withContext,
      withParsedIpfsUrl,
      withDenylist,
      withCdnCache
    )
    return middleware(handler)(request, env, ctx)
  }
}

/** @type {import('@web3-storage/gateway-lib').Handler<IpfsUrlContext, Environment>} */
async function handler (request, env, ctx) {
  const { dataCid, path, searchParams } = ctx
  if (!searchParams) {
    throw new Error('missing URL search params')
  }
  if (!(searchParams.get('format') === 'car' || request.headers.get('Accept')?.includes('application/vnd.ipld.car'))) {
    throw new HttpError('not acceptable', { status: 406 })
  }
  if (!env.GATEWAY_URL) {
    throw new Error('missing environment variable: GATEWAY_URL')
  }
  const url = new URL(`/ipfs/${dataCid}${path.split('/').map(encodeURIComponent).join('/')}${searchParams.size ? '?' : ''}${searchParams}`, env.GATEWAY_URL)
  return fetch(url, { headers: new Headers(request.headers) })
}

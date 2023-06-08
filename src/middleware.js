/* eslint-env worker */
import { HttpError } from '@web3-storage/gateway-lib/util'

/**
 * @typedef {import('./bindings').Environment} Environment
 * @typedef {import('@web3-storage/gateway-lib').IpfsUrlContext} IpfsUrlContext
 */

/**
 * @type {import('@web3-storage/gateway-lib').Middleware<IpfsUrlContext, IpfsUrlContext, Environment>}
 */
export function withDenylist (handler) {
  return async (request, env, ctx) => {
    if (!env.GATEWAY_URL) {
      throw new Error('missing environment variable: GATEWAY_URL')
    }

    const res = await fetch(new URL(`/${ctx.dataCid.toV1()}`, env.DENYLIST_API_URL), {
      // Allow Cloudflare to cache the content, and set a big TTL
      // https://developers.cloudflare.com/workers/runtime-apis/request#requestinitcfproperties
      // @ts-expect-error
      cf: {
        cacheEverything: true,
        cacheTtl: 120 // (1 hour) we almost never remove from the deny list...
      }
    })
    // successful response indicates it is on the deny list
    if (res.status === 200) {
      throw new HttpError('', { status: 410 })
    }

    return handler(request, env, ctx)
  }
}

/**
 * Intercepts request if content cached by just returning cached response.
 * Otherwise proceeds to handler.
 *
 * Note: Different from middleware provided by gateway-lib as this attempts to
 * caches everything, not just responses with a Content-Length, since we'll
 * never have a Content-Length set!
 *
 * @type {import('@web3-storage/gateway-lib').Middleware<import('@web3-storage/gateway-lib').Context>}
 */
export function withCdnCache (handler) {
  return async (request, env, ctx) => {
    // Should skip cache if instructed by headers
    if ((request.headers.get('Cache-Control') ?? '').includes('no-cache')) {
      return handler(request, env, ctx)
    }

    let response
    // Get from cache and return if existent
    /** @type {Cache} */
    // @ts-ignore Cloudflare Workers runtime exposes a single global cache object.
    const cache = caches.default
    response = await cache.match(request)
    if (response) {
      return response
    }

    // If not cached and request wants it _only_ if it is cached, send 412
    if (request.headers.get('Cache-Control') === 'only-if-cached') {
      return new Response(null, { status: 412 })
    }

    response = await handler(request, env, ctx)

    // cache the repsonse if success status
    if (response.ok) {
      ctx.waitUntil(cache.put(request, response.clone()))
    }

    return response
  }
}

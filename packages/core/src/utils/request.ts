import { socksDispatcher } from 'fetch-socks'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { logger } from 'koishi-plugin-chatluna'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { SocksProxyAgent } from 'socks-proxy-agent'
import unidci, { FormData, ProxyAgent } from 'undici'
import * as fetchType from 'undici/types/fetch'
// eslint-disable-next-line @typescript-eslint/naming-convention
import UserAgents from 'user-agents'
import useragent from 'useragent'
import { ClientRequestArgs } from 'http'
import { ClientOptions, WebSocket } from 'ws'

export { FormData }

function createProxyAgentForFetch(
    init: fetchType.RequestInit,
    proxyAddress: string
): fetchType.RequestInit {
    if (init.dispatcher || globalProxyAddress == null) {
        return init
    }

    let proxyAddressURL: URL

    try {
        proxyAddressURL = new URL(proxyAddress)
    } catch (e) {
        logger?.error(
            '无法解析你的代理地址，请检查你的代理地址是否正确！（例如是否添加了http://）'
        )
        logger?.error(e)
        throw e
    }

    if (proxyAddress.startsWith('socks://')) {
        init.dispatcher = socksDispatcher({
            type: 5,
            host: proxyAddressURL.hostname,
            port: proxyAddressURL.port ? parseInt(proxyAddressURL.port) : 1080
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any
        // match http/https
    } else if (proxyAddress.match(/^https?:\/\//)) {
        init.dispatcher = new ProxyAgent({
            uri: proxyAddress
        })
    } else {
        throw new ChatLunaError(
            ChatLunaErrorCode.UNSUPPORTED_PROXY_PROTOCOL,
            new Error('Unsupported proxy protocol')
        )
    }

    // koishi now use undici, never set the global scheduler!!!

    // global[Symbol.for('undici.globalDispatcher.1')] = init.dispatcher
    // setGlobalDispatcher(init.dispatcher)

    return init
}

function createProxyAgent(
    proxyAddress: string
): HttpsProxyAgent<string> | SocksProxyAgent {
    if (proxyAddress.startsWith('socks://')) {
        return new SocksProxyAgent(proxyAddress)
    } else if (proxyAddress.match(/^https?:\/\//)) {
        return new HttpsProxyAgent(proxyAddress)
    } else {
        throw new ChatLunaError(
            ChatLunaErrorCode.UNSUPPORTED_PROXY_PROTOCOL,
            new Error('Unsupported proxy protocol')
        )
    }
}

export let globalProxyAddress: string | null = global['globalProxyAddress']

export function setGlobalProxyAddress(address: string) {
    if (address.startsWith('socks://') || address.match(/^https?:\/\//)) {
        globalProxyAddress = address
        global['globalProxyAddress'] = address
    } else {
        throw new ChatLunaError(
            ChatLunaErrorCode.UNSUPPORTED_PROXY_PROTOCOL,
            new Error('Unsupported proxy protocol')
        )
    }
}

/**
 * package undici, and with proxy support
 * @returns
 */
export function chatLunaFetch(
    info: fetchType.RequestInfo,
    init?: fetchType.RequestInit,
    proxyAddress: string = globalProxyAddress
) {
    if (proxyAddress !== 'null' && proxyAddress != null && !init?.dispatcher) {
        init = createProxyAgentForFetch(init || {}, proxyAddress)
    }

    try {
        return unidci.fetch(info, init)
    } catch (e) {
        if (e.cause) {
            logger.error(e.cause)
        }
        throw e
    }
}

/**
 * package ws, and with proxy support
 */
export function ws(
    url: string,
    options?: ClientOptions | ClientRequestArgs,
    proxyAddress: string = globalProxyAddress
) {
    if (proxyAddress !== 'null' && proxyAddress != null && !options?.agent) {
        options = options || {}
        options.agent = createProxyAgent(proxyAddress)
    }
    return new WebSocket(url, options)
}

export function randomUA() {
    let result: string | null = null

    let count = 0
    while (result == null) {
        const generated = UserAgents.random((rawUA) => {
            const parsedUA = useragent.parse(rawUA.userAgent)
            return (
                useragent.is(rawUA.userAgent).chrome &&
                (count < 15 || parseFloat(parsedUA.major) >= 90)
            )
        })

        if (generated != null) {
            result = generated.toString()
        }

        if (count > 20) {
            break
        }

        count++
    }

    return result
}

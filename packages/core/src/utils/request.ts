import unidci, { ProxyAgent } from 'undici'
import * as fetchType from 'undici/types/fetch'
import { ClientOptions, WebSocket } from 'ws'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { socksDispatcher } from 'fetch-socks'
import { createLogger } from './logger'
import { ClientRequestArgs } from 'http'
import * as RandomUserAgent from 'random-useragent'
import { ChatHubError, ChatHubErrorCode } from './error'

const logger = createLogger()

function createProxyAgentForFetch(init: fetchType.RequestInit, proxyAddress: string): fetchType.RequestInit {
    if (init.dispatcher || globalProxyAddress == null) {
        return init
    }

    let proxyAddressURL: URL

    try {
        proxyAddressURL = new URL(proxyAddress)
    } catch (e) {
        logger.error('无法解析你的代理地址，请检查你的代理地址是否正确！（例如是否添加了http://）')
        logger.error(e)
        throw e
    }

    if (proxyAddress.startsWith('socks://')) {
        init.dispatcher = socksDispatcher({
            type: 5,
            host: proxyAddressURL.hostname,
            port: proxyAddressURL.port ? parseInt(proxyAddressURL.port) : 1080
        })
        // match http/https
    } else if (proxyAddress.match(/^https?:\/\//)) {
        init.dispatcher = new ProxyAgent(proxyAddress)
    } else {
        throw new ChatHubError(ChatHubErrorCode.UNSUPPORTED_PROXY_PROTOCOL, new Error('Unsupported proxy protocol'))
    }

    // set to global

    global[Symbol.for('undici.globalDispatcher.1')] = init.dispatcher

    return init
}

function createProxyAgent(proxyAddress: string): HttpsProxyAgent<string> | SocksProxyAgent {
    if (proxyAddress.startsWith('socks://')) {
        return new SocksProxyAgent(proxyAddress)
    } else if (proxyAddress.match(/^https?:\/\//)) {
        return new HttpsProxyAgent(proxyAddress)
    } else {
        throw new ChatHubError(ChatHubErrorCode.UNSUPPORTED_PROXY_PROTOCOL, new Error('Unsupported proxy protocol'))
    }
}

let globalProxyAddress: string | null = null

export function setGlobalProxyAddress(address: string) {
    if (address.startsWith('socks://') || address.match(/^https?:\/\//)) {
        globalProxyAddress = address
    } else {
        throw new ChatHubError(ChatHubErrorCode.UNSUPPORTED_PROXY_PROTOCOL, new Error('Unsupported proxy protocol'))
    }
}

/**
 * package undici, and with proxy support
 * @returns
 */
export function chathubFetch(info: fetchType.RequestInfo, init?: fetchType.RequestInit) {
    if (globalProxyAddress != null && !init?.dispatcher) {
        init = createProxyAgentForFetch(init || {}, globalProxyAddress)
    }

    // logger.debug(`[fetch] ${info} ${JSON.stringify(init)}`);

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
export function ws(url: string, options?: ClientOptions | ClientRequestArgs) {
    if (globalProxyAddress && !options?.agent) {
        options = options || {}
        options.agent = createProxyAgent(globalProxyAddress)
    }
    return new WebSocket(url, options)
}

export function randomUA() {
    return RandomUserAgent.getRandom((ua) => ua.browserName === 'Chrome' && parseFloat(ua.browserVersion) >= 90)
}

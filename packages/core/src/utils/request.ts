import unidci, { Agent, ProxyAgent } from 'undici';
import * as  fetchType from 'undici/types/fetch';
import { WebSocket, ClientOptions } from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { socksDispatcher } from "fetch-socks";
import { createLogger } from './logger';
import { ClientRequestArgs } from 'http';
import { ChatHubError, ChatHubErrorCode } from './error';

const logger = createLogger('@dingyi222666/chathub/request');

function createProxyAgentForFetch(init: fetchType.RequestInit, proxyAddress: string): fetchType.RequestInit {

    if (init.dispatcher || request.globalProxyAddress == null) {
        return init;
    }

    let proxyAddressURL: URL

    try {
        proxyAddressURL = new URL(proxyAddress);
    } catch (e) {
        logger.error("无法解析你的代理地址，请检查你的代理地址是否正确！（例如是否添加了http://）")
        logger.error(e)
        throw e
    }

    if (proxyAddress.startsWith('socks://')) {
        init.dispatcher = socksDispatcher({
            type: 5,
            host: proxyAddressURL.hostname,
            port: proxyAddressURL.port ? parseInt(proxyAddressURL.port) : 1080,
        })
        // match http/https
    } else if (proxyAddress.match(/^https?:\/\//)) {
        init.dispatcher = new ProxyAgent(proxyAddress);
    } else {
        throw new ChatHubError(ChatHubErrorCode.UNSUPPORTED_PROXY_PROTOCOL, new Error("Unsupported proxy protocol"))
    }

    // set to global

    global[Symbol.for("undici.globalDispatcher.1")] = init.dispatcher;

    return init;
}

function createProxyAgent(proxyAddress: string): HttpsProxyAgent<string> | SocksProxyAgent {
    if (proxyAddress.startsWith('socks://')) {
        return new SocksProxyAgent(proxyAddress);
    } else if (proxyAddress.match(/^https?:\/\//)) {
        return new HttpsProxyAgent(proxyAddress);
    } else {
        throw new ChatHubError(ChatHubErrorCode.UNSUPPORTED_PROXY_PROTOCOL, new Error("Unsupported proxy protocol"))
    }
}

export namespace request {

    export let globalProxyAddress: string | null = null;

    /**
     * package undici, and with proxy support
     * @returns 
     */
    export function fetch(info: fetchType.RequestInfo, init?: fetchType.RequestInit) {
        if (globalProxyAddress != null && !init?.dispatcher) {
            init = createProxyAgentForFetch(init || {}, globalProxyAddress);
        }

        //logger.debug(`[fetch] ${info} ${JSON.stringify(init)}`);

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
            options = options || {};
            options.agent = createProxyAgent(globalProxyAddress);
        }
        return new WebSocket(url, options);
    }

    /**
     * @deprecated use random-ua package instead
     */
    export function randomUA() {
        const first = Math.floor(Math.random() * (76 - 55)) + 55
        const third = Math.floor(Math.random() * 3800)
        const fourth = Math.floor(Math.random() * 140)
        const os_type = ['(Windows NT 6.1; WOW64)', '(Windows NT 10.0; WOW64)', '(X11; Linux x86_64)', '(Macintosh; Intel Mac OS X 10_14_5)']
        const chrome_version = `Chrome/${first}.0.${third}.${fourth}`
        return `Mozilla/5.0 ${os_type[Math.floor(Math.random() * os_type.length)]} AppleWebKit/537.36 (KHTML, like Gecko) ${chrome_version} Safari/537.36`
    }
}
import unidci, { ProxyAgent } from 'undici';
import * as  fetchType from 'undici/types/fetch';
import { WebSocket, ClientOptions } from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { socksDispatcher } from "fetch-socks";
import { createLogger } from './logger';

const logger = createLogger('@dingyi222666/chathub/request');

function createProxyAgentForFetch(init: fetchType.RequestInit, proxyAdress: string): fetchType.RequestInit {

    if (init.dispatcher || request.globalProxyAdress == null) {
        return init;
    }

    const proxyAdressURL = new URL(proxyAdress);

    if (proxyAdress.startsWith('socks://')) {
        init.dispatcher = socksDispatcher({
            type: 5, //sock5 (还有4？？)
            host: proxyAdressURL.hostname,
            port: proxyAdressURL.port ? parseInt(proxyAdressURL.port) : 1080,
        })
        // match http/https
    } else if (proxyAdress.match(/^https?:\/\//)) {
        init.dispatcher = new ProxyAgent(proxyAdress);
    } else {
        // 还需要做adapter吗？我觉得不需要了呢
        throw new Error('Unsupported proxy protocol');
    }

    return init;
}

function createProxyAgent(proxyAdress: string): HttpsProxyAgent | SocksProxyAgent {
    if (proxyAdress.startsWith('socks://')) {
        return new SocksProxyAgent(proxyAdress);
    } else if (proxyAdress.match(/^https?:\/\//)) {
        return new HttpsProxyAgent(proxyAdress);
    } else {
        // 还需要做adapter吗？我觉得不需要了呢
        throw new Error('Unsupported proxy protocol');
    }
}

export namespace request {

    export var globalProxyAdress: string | null = null;


    /**
     * package undici, and with proxy support
     * @returns 
     */
    export function fetch(info: fetchType.RequestInfo, init?: fetchType.RequestInit) {
        if (globalProxyAdress != null && !init?.dispatcher) {
            init = createProxyAgentForFetch(init || {}, globalProxyAdress);
        }
        
        //logger.debug(`[fetch] ${info} ${JSON.stringify(init)}`);

        return unidci.fetch(info, init)
    }

    /**
     * package ws, and with proxy support
     */
    export function ws(url: string, options?: ClientOptions) {
        if (globalProxyAdress && !options?.agent) {
            options = options || {};
            options.agent = createProxyAgent(globalProxyAdress);
        }
        return new WebSocket(url, options);
    }
}
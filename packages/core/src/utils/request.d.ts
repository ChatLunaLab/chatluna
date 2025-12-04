import { Agent, buildConnector, FormData } from 'undici'
import * as fetchType from 'undici/types/fetch'
import { ClientRequestArgs } from 'http'
import { ClientOptions, WebSocket } from 'ws'
import Connector = buildConnector.connector
import TLSOptions = buildConnector.BuildOptions
export { FormData }
export declare let globalProxyAddress: string | null
export declare function setGlobalProxyAddress(address: string): void
/**
 * package undici, and with proxy support
 * @returns
 */
export declare function chatLunaFetch(
    info: fetchType.RequestInfo,
    init?: fetchType.RequestInit,
    proxyAddress?: string
): Promise<fetchType.Response>
/**
 * package ws, and with proxy support
 */
export declare function ws(
    url: string,
    options?: ClientOptions | ClientRequestArgs,
    proxyAddress?: string
): WebSocket
export declare function randomUA(): string
export type SocksProxies = URL
/**
 * Create an Undici connector which establish the connection through socks proxies.
 *
 * If the proxies is an empty array, it will connect directly.
 *
 * @param proxies The proxy server to use or the list of proxy servers to chain.
 * @param tlsOpts TLS upgrade options.
 */
export declare function socksConnector(
    url: URL,
    tlsOpts?: TLSOptions
): Connector
export interface SocksDispatcherOptions extends Agent.Options {
    /**
     * TLS upgrade options, see:
     * https://undici.nodejs.org/#/docs/api/Client?id=parameter-connectoptions
     *
     * The connect function is not supported.
     * If you want to create a custom connector, you can use `socksConnector`.
     */
    connect?: TLSOptions
}
/**
 * Create a Undici Agent with socks connector.
 *
 * If the proxies is an empty array, it will connect directly.
 *
 * @param proxies The proxy server to use or the list of proxy servers to chain.
 * @param options Additional options passed to the Agent constructor.
 */
export declare function socksDispatcher(
    proxies: SocksProxies,
    options?: SocksDispatcherOptions
): Agent

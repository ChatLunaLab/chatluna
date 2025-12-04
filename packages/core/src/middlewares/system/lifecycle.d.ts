import { Context } from 'koishi'
import { Config } from '../../config'
import { ChatChain } from '../../chains/chain'
export declare function apply(
    ctx: Context,
    config: Config,
    chain: ChatChain
): void
export declare const lifecycleNames: string[]
declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        /**
         * lifecycle of the middleware execution, it mean the check chain can continue to execute if the middleware return true
         */
        'lifecycle-check': never
        /**
         * lifecycle of the middleware execution, it mean the middleware will be prepare some data for the next middleware
         */
        'lifecycle-prepare': never
        /**
         * lifecycle of the middleware execution, it mean the middleware will be request to the model
         */
        'lifecycle-request_model': never
        /**
         * lifecycle of the middleware execution, it mean the middleware will be send message
         */
        'lifecycle-send': never
        /**
         * lifecycle of the middleware execution, it mean the middleware will be handle command
         */
        'lifecycle-handle_command': never
    }
}

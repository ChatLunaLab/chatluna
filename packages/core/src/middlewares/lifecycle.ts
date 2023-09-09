import { Context } from 'koishi'
import { Config } from '../config'
import { ChatChain } from '../chains/chain'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('lifecycle-check', async (session, context) => 0)

        .before('lifecycle-prepare')

    chain
        .middleware('lifecycle-prepare', async (session, context) => 0)
        .after('lifecycle-check')
        .before('lifecycle-request_model')

    chain
        .middleware('lifecycle-handle_command', async (session, context) => 0)
        .after('lifecycle-prepare')
        .before('lifecycle-request_model')

    chain
        .middleware('lifecycle-request_model', async (session, context) => 0)
        .after('lifecycle-prepare')
        .before('lifecycle-send')

    chain
        .middleware('lifecycle-send', async (session, context) => 0)
        .after('lifecycle-request_model')
}

export const lifecycleNames = [
    'lifecycle-check',
    'lifecycle-prepare',
    'lifecycle-handle_command',
    'lifecycle-request_model',
    'lifecycle-send'
]

declare module '../chains/chain' {
    export interface ChainMiddlewareName {
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

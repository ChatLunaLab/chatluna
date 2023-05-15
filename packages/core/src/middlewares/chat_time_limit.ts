import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareContext, ChatChain } from '../chain';
import { ConversationInfo } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { getKeysCache } from '..';
import { Preset } from '../preset';

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("chat_time_limit", async (session, context) => {

       
        return true
    }).after("resolve_model")
    .before("request_model")
    //  .before("lifecycle-request_model")
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "chat_time_limit": never
    }
}

import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareContext, ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { ConversationInfo } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { getKeysCache } from '..';
import { Preset } from '../preset';

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("resolve_model", async (session, context) => {

        const options = context.options

        const conversationInfo = options.conversationInfo

        if (conversationInfo.model != null) {
            return ChainMiddlewareRunStatus.SKIPPED
        } else {
            throw new Error("无法找到模型，是否设置了默认模型或者没指定模型？")
        }

    }).before("request_model")
    //  .before("lifecycle-request_model")


}

declare module '../chain' {
    interface ChainMiddlewareName {
        "resolve_model": never
    }
}



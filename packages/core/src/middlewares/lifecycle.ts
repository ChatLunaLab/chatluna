import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chain';
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';

const logger = createLogger("@dingyi222666/chathub-llm-core/middlewares/lifecycle")

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("lifecycle-check", async (session, context) => true)

    chain.middleware("lifecycle-prepare", async (session, context) => true).after("lifecycle-check")

    chain.middleware("lifecycle-request_model", async (session, context) => true).after("lifecycle-prepare")


    chain.middleware("lifecycle-send", async (session, context) => true).after("lifecycle-request_model")
}
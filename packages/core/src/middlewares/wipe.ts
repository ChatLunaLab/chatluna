import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '../llm-core/utils/logger';
import { generateExpression } from './delete_all_converstion';
import fs from 'fs/promises'

const logger = createLogger("@dingyi222666/chathub/middlewares/black_list")

export function apply(ctx: Context, config: Config, chain: ChatChain) {

    chain.middleware("wipe", async (session, context) => {

        const { command } = context

        if (command !== "wipe") return ChainMiddlewareRunStatus.SKIPPED

        const buffer = ["您接下来将要操作的是清除 chathub 的全部相关数据！这些数据包括", "\n1. 所有的会话数据", "2. 其他缓存在数据库的数据", "3. 本地向量数据库的相关数据"]

        const expression = generateExpression()

        buffer.push(`\n请输入下列算式的结果以确认删除：${expression.expression}。`)

        await context.send(buffer.join("\n"))

        await context.recallThinkingMessage()

        const result = await session.prompt(1000 * 30)

        if (!result) {
            context.message = `删除超时，已取消删除`
            return ChainMiddlewareRunStatus.STOP
        }

        if (result !== expression.result.toString()) {
            context.message = `你的输入不正确，已取消删除。`
            return ChainMiddlewareRunStatus.STOP
        }

        // drop database tables

        await ctx.database.drop("chathub_conversation_info")
        await ctx.database.drop("chathub_conversaion")
        await ctx.database.drop("chathub_message")
        await ctx.database.drop('chathub_sender_info')

        // dorp caches

        await ctx.cache.clear('chathub/chat_limit')
        await ctx.cache.clear("chathub/keys")

        // delete local database and tmps

        try {
            await fs.rm("data/chathub/vectorstrore", { recursive: true })
        } catch (e) {
            logger.warn(`wipe: ${e}`)
        }

        try {
            await fs.rm("data/chathub/temp", { recursive: true })
        } catch (e) {
            logger.warn(`wipe: ${e}`)
        }

        context.message = `已删除相关数据，即将重启完成更改。`

        ctx.scope.update(config, true)

        return ChainMiddlewareRunStatus.STOP
    }).before("black_list")
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "wipe": never
    }
}
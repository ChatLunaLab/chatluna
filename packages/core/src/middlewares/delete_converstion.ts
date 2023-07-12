import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '../llm-core/utils/logger';
import { Factory } from '../llm-core/chat/factory';
import { preset } from './resolve_preset';
import { ChatInterface } from '../llm-core/chat/app';
import { formatConversationInfo } from './query_converstion';

const logger = createLogger("@dingyi222666/chathub/middlewares/delete_converstaion")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("delete_converstaion", async (session, context) => {

        const { command, options: { conversationInfo } } = context

        if (command !== "delete_converstaion") return ChainMiddlewareRunStatus.SKIPPED

        const buffer = ["您接下来将要删除这个会话！注意删除后会话的相关数据都会被删除！"]

        buffer.push(formatConversationInfo(conversationInfo))

        buffer.push("\n输入大写 Y 来确认删除，输入其他字符来取消删除")

        await context.send(buffer.join("\n"))

        await context.recallThinkingMessage()

        const result = await session.prompt(1000 * 30)

        if (!result) {
            context.message = `删除会话超时，已取消删除会话: ${conversationInfo.conversationId}`
            return ChainMiddlewareRunStatus.STOP
        }

        if (result !== "Y") {
            context.message = `已取消删除会话: ${conversationInfo.conversationId}`
            return ChainMiddlewareRunStatus.STOP
        }

        const chatInterface = ctx.chathub.queryBridger(conversationInfo)

        await chatInterface.delete(conversationInfo)

        context.message = `已删除会话: ${conversationInfo.conversationId}`

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "delete_converstaion": never
    }

    interface ChainMiddlewareContextOptions {
        converstaionId?: string
    }
}
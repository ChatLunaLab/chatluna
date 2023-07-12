import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '../llm-core/utils/logger';
import { Factory } from '../llm-core/chat/factory';
import { preset } from './resolve_preset';
import { ChatInterface } from '../llm-core/chat/app';
import { formatConversationInfo } from './query_converstion';

const logger = createLogger("@dingyi222666/chathub/middlewares/delete_all_converstaion")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("delete_all_converstaion", async (session, context) => {

        const { command, options: { senderInfo } } = context

        if (command !== "delete_all_converstaion") return ChainMiddlewareRunStatus.SKIPPED

        const buffer = ["您接下来将要删除目前和你相关的所有会话！注意删除后会话的相关数据都会被删除！"]


        const expression = generateExpression()

        buffer.push(`\n请输入下列算式的结果以确认删除：${expression.expression}。`)

        await context.send(buffer.join("\n"))

        await context.recallThinkingMessage()

        const result = await session.prompt(1000 * 30)

        if (!result) {
            context.message = `删除会话超时，已取消删除和你相关的所有会话。`
            return ChainMiddlewareRunStatus.STOP
        }

        if (result !== expression.result.toString()) {
            context.message = `你的输入不正确，已取消删除和你相关的所有会话。`
            return ChainMiddlewareRunStatus.STOP
        }

        const conversationList = await ctx.database.get("chathub_conversation_info", {
            senderId: senderInfo.senderId,
        })

        for (const conversationInfo of conversationList) {
            try {
                await ctx.database.remove("chathub_conversaion", { id: conversationInfo.conversationId })
            } catch (e) {
                logger.warn(`delete_all_converstaion: ${e}`)
            }
            await ctx.database.remove("chathub_conversation_info", { conversationId: conversationInfo.conversationId })
            await ctx.database.remove("chathub_message", { conversation: conversationInfo.conversationId })
        }

        context.message = `已删除和你相关的所有会话，即将自动重启完成更改。`

        ctx.scope.update(config, true)


        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

// 接下来请你给我写这样的代码：随机生成一个三位数的加，乘，减，除 算式并生成字符以及结果。如 { expression: "111+444", result: 555 }

export function generateExpression() {
    const operators = ["+", "-", "*"]

    const operator = operators[Math.floor(Math.random() * operators.length)]

    const a = Math.floor(Math.random() * 1000)

    const b = Math.floor(Math.random() * 1000)

    const result = eval(`${a}${operator}${b}`)

    return {
        expression: `${a}${operator}${b}`,
        result
    }
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "delete_all_converstaion": never
    }

}
import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '../llm-core/utils/logger';
import { ConversationInfo } from '../types';
import { ChatMode } from './resolve_conversation_info';

const logger = createLogger("@dingyi222666/chathub/middlewares/query_converstion")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("query_converstion", async (session, context) => {

        const { command } = context

        if (command !== "query_converstion") return ChainMiddlewareRunStatus.SKIPPED

        const buffer = ["以下是目前查询到的会话列表"]

        let modelName = context.options?.setModel

        const query = {
            senderId: context.options.senderInfo?.senderId,
            chatMode: {
                $regex: context.options.chatMode ? new RegExp(context.options.chatMode, "i") : new RegExp("(.*)")
            },
            // use '' to query all
            model: { $regex: modelName ? new RegExp(modelName, "i") : undefined },
        }

        if (query.model.$regex == null) {
            delete query.model
        }

        const conversationInfoList = (await ctx.database.get("chathub_conversation_info", query))

        logger.debug(`query_converstion: ${JSON.stringify(query)} => ${JSON.stringify(conversationInfoList)}`)

        for (const conversation of conversationInfoList) {
            buffer.push(formatConversationInfo(conversation))
        }

        buffer.push("\n你可以使用 chathub.chat -m <model> -c <chatMode> <message> 来和指定的模型使用指定的聊天模式进行对话")

        context.message = buffer.map(text => [h.text(text)])

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

export function formatConversationInfo(conversationInfo: ConversationInfo) {
    const buffer = []
  //  buffer.push("\n")
    buffer.push(`会话ID: ${conversationInfo.conversationId}`)
    buffer.push(`模型: ${conversationInfo.model}`)
    buffer.push(`预设: ${conversationInfo.preset}`)
    buffer.push(`聊天模式: ${conversationInfo.chatMode}`)

    return buffer.join("\n")

}

declare module '../chain' {
    interface ChainMiddlewareName {
        "query_converstion": never
    }
}
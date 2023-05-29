import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '../llm-core/utils/logger';
import { Factory } from '../llm-core/chat/factory';
import { ModelProvider } from '../llm-core/model/base';

const logger = createLogger("@dingyi222666/chathub/middlewares/list_all_model")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("list_all_chat_mode", async (session, context) => {

        const { command } = context

        if (command !== "listChatMode") return ChainMiddlewareRunStatus.SKIPPED

        const buffer = ["以下是目前可用的聊天模式"]

        const modes = {
            "chat": "仅聊天的模式，支持设置预设，支持长期记忆（向量数据库），对于部分平台接入可能会不支持预设的设置和长期记忆。",
            "browsing": "目标是实现类似 ChatGPT 的浏览模式，基于 LangChain 开发，允许模型使用有限的工具调用以实现从外部获取信息，不支持长期记忆，并且只支持 OpenAI API 这类完整可自定义历史对话的适配器。",
            "plugin": "基于 LangChain 官方提供的相关 Agent 工具链开发的模式，可以让模型调用各类插件能力，其他插件也可以注册工具来让模型调用。缺点如 browsing 模式。"
        }

        for (const mode in modes) {
            buffer.push(mode + ": " + modes[mode])
        }

        buffer.push("\n你可以使用 chathub.chat -m <model> -c <chatMode> <message> 来和指定的模型使用指定的聊天模式进行对话")

        context.message = buffer.join("\n")

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "list_all_chat_mode": never
    }
}
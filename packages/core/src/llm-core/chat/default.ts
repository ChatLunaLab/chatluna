import { Context } from 'koishi'
import { logger } from 'koishi-plugin-chatluna'
import { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import { ChatLunaChatChain } from '../chain/chat_chain'
import { ChatLunaPluginChain } from '../chain/plugin_chat_chain'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { computed } from '@vue/reactivity'
import {
    chatChainSchema,
    embeddingsSchema,
    modelSchema,
    vectorStoreSchema
} from 'koishi-plugin-chatluna/utils/schema'

export async function defaultFactory(ctx: Context, service: PlatformService) {
    modelSchema(ctx, true)
    vectorStoreSchema(ctx)
    embeddingsSchema(ctx)
    chatChainSchema(ctx)

    ctx.on('chatluna/model-removed', (service, platform) => {
        const wrapper = ctx.chatluna.getCachedInterfaceWrapper()

        if (wrapper == null) {
            return
        }

        wrapper
            .getCachedConversations()
            .filter(
                ([_, conversation]) =>
                    conversation.room &&
                    parseRawModelName(conversation.room.model)[0] === platform
            )
            .forEach(async ([id, info]) => {
                const result = await wrapper.clearCache(info.room)

                if (result) {
                    logger?.debug(`Cleared cache for room ${id}`)
                }
            })
    })

    ctx.on('chatluna/tool-updated', () => {
        const wrapper = ctx.chatluna.getCachedInterfaceWrapper()

        if (wrapper == null) {
            return
        }

        wrapper
            .getCachedConversations()
            .filter(
                ([_, conversation]) =>
                    conversation?.chatInterface?.chatMode === 'plugin' ||
                    conversation?.chatInterface?.chatMode === 'browsing'
            )
            .forEach(async ([id, info]) => {
                const result = await wrapper.clearCache(info.room)

                if (result) {
                    logger?.debug(`Cleared cache for room ${id}`)
                }
            })
    })

    service.registerChatChain(
        'chat',
        { 'zh-CN': '聊天模式', 'en-US': 'Chat mode' },
        (params) =>
            ChatLunaChatChain.fromLLM(params.model, {
                variableService: ctx.chatluna.promptRenderer,
                botName: params.botName,
                preset: params.preset,
                historyMemory: params.historyMemory
            })
    )

    service.registerChatChain(
        'plugin',
        {
            'zh-CN': 'Agent 模式',
            'en-US': 'Agent mode'
        },
        (params) =>
            ChatLunaPluginChain.fromLLMAndTools(
                params.model,
                getTools(service),
                {
                    variableService: ctx.chatluna.promptRenderer,
                    preset: params.preset,
                    historyMemory: params.historyMemory,
                    embeddings: params.embeddings,
                    agentMode: params.supportChatChain
                        ? 'tool-calling'
                        : 'react'
                }
            )
    )
}

function getTools(service: PlatformService) {
    const tools = service.getTools()

    return computed(() => tools.value.map((name) => service.getTool(name)))
}

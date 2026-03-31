import { Context } from 'koishi'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { logger } from '../..'
import { Config } from '../../config'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('resolve_model', async (session, context) => {
            const conversationId = context.options.conversationId

            if ((context.command?.length ?? 0) > 1) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            if (conversationId == null) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            try {
                const conversation =
                    context.options.resolvedConversation ??
                    (await ctx.chatluna.conversation.getConversation(
                        conversationId
                    ))

                if (conversation == null) {
                    return ChainMiddlewareRunStatus.STOP
                }

                const modelName =
                    conversation.model == null ||
                    conversation.model.trim().length < 1 ||
                    conversation.model === '无' ||
                    conversation.model === 'empty'
                        ? 'empty'
                        : conversation.model

                const [platformName, rawModelName] =
                    parseRawModelName(modelName)
                const presetExists =
                    ctx.chatluna.preset.getPreset(conversation.preset, false)
                        .value != null

                if (
                    modelName === 'empty' ||
                    platformName == null ||
                    rawModelName == null
                ) {
                    await context.send(
                        session.text(
                            'chatluna.conversation.messages.unavailable',
                            [modelName]
                        )
                    )
                    return ChainMiddlewareRunStatus.STOP
                }

                const platformModels = ctx.chatluna.platform.listPlatformModels(
                    platformName,
                    ModelType.llm
                ).value

                if (
                    platformModels.length > 0 &&
                    platformModels.some((it) => it.name === rawModelName) &&
                    presetExists
                ) {
                    return ChainMiddlewareRunStatus.CONTINUE
                }

                await context.send(
                    session.text('chatluna.conversation.messages.unavailable', [
                        modelName
                    ])
                )
                return ChainMiddlewareRunStatus.STOP
            } catch (e) {
                logger.error(e)
                return ChainMiddlewareRunStatus.STOP
            }
        })
        .before('lifecycle-request_conversation')
        .after('lifecycle-prepare')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        resolve_model: never
    }
}

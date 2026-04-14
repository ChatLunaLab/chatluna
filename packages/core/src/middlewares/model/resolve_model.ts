import { Context } from 'koishi'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { logger } from '../..'
import { Config } from '../../config'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('resolve_model', async (session, context) => {
            const resolved = context.options.conversation

            if ((context.command?.length ?? 0) > 1) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            if (resolved == null) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            try {
                const modelName =
                    resolved.effectiveModel ??
                    resolved.conversation?.model ??
                    config.defaultModel ??
                    'empty'
                const presetName =
                    resolved.effectivePreset ??
                    resolved.conversation?.preset ??
                    config.defaultPreset
                const presetExists =
                    presetName != null &&
                    ctx.chatluna.preset.getPreset(presetName, false).value !=
                        null

                if (
                    !presetExists ||
                    modelName.trim().length < 1 ||
                    modelName === '无' ||
                    modelName === 'empty'
                ) {
                    await context.send(
                        session.text(
                            'chatluna.conversation.messages.unavailable',
                            [modelName]
                        )
                    )
                    return ChainMiddlewareRunStatus.STOP
                }

                const [platformName, rawModelName] =
                    parseRawModelName(modelName)

                if (platformName == null || rawModelName == null) {
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
                    platformModels.some((it) => it.name === rawModelName)
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

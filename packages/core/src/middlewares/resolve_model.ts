import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { createLogger } from '../utils/logger'
import { parseRawModelName } from '../llm-core/utils/count_tokens'
import { ModelType } from '../llm-core/platform/types'
import { ChatHubError, ChatHubErrorCode } from '../utils/error'

const logger = createLogger()

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const service = ctx.chathub.platform

    chain
        .middleware('resolve_model', async (session, context) => {
            const { room } = context.options

            const { model: fullModelName } = room

            const [platform, modelName] = parseRawModelName(fullModelName)

            const models = service.getModels(platform, ModelType.llm)

            if (models.length < 1) {
                throw new ChatHubError(
                    ChatHubErrorCode.MODEL_ADAPTER_NOT_FOUND,
                    new Error(`Can't find model adapter for ${fullModelName}`)
                )
            }

            if (models.length == 0 || models.find((x) => x.name === modelName) == null) {
                // 这比较难，强行 fallback 到推荐模型

                const recommendModel = platform + '/' + models[0].name

                logger.debug(`[resolve_model] recommendModel: ${recommendModel}`)

                await context.send(
                    '检查到您可能更新了某些配置，已无法使用之前设置的旧的模型，已为您自动切换到其他可用模型。'
                )

                room.model = recommendModel

                ctx.database.upsert('chathub_room', [room])

                return ChainMiddlewareRunStatus.CONTINUE
            }

            if (room.model != null) {
                return ChainMiddlewareRunStatus.SKIPPED
            } else {
                throw new ChatHubError(
                    ChatHubErrorCode.MODEL_ADAPTER_NOT_FOUND,
                    new Error(`Can't find model adapter for ${fullModelName}`)
                )
            }
        })
        .before('request_model')
    //  .before("lifecycle-request_model")
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        resolve_model: never
    }
}

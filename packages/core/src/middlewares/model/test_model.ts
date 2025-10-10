import { Context } from 'koishi'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { Config } from '../../config'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { AIMessageChunk } from '@langchain/core/messages'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const services = ctx.chatluna.platform

    chain
        .middleware('test_model', async (session, context) => {
            const {
                command,
                options: { model }
            } = context

            if (command !== 'test_model')
                return ChainMiddlewareRunStatus.SKIPPED

            let platformName: string
            let modelName: string

            try {
                // Check if the input contains '/'
                if (!model.includes('/')) {
                    // Get all models from the specified platform
                    const platformModels = services.listPlatformModels(
                        model,
                        ModelType.llm
                    )

                    if (
                        !platformModels.value ||
                        platformModels.value.length === 0
                    ) {
                        context.message = session.text('.platform_not_found', [
                            model
                        ])
                        return ChainMiddlewareRunStatus.STOP
                    }

                    // Randomly select a model from the platform
                    const randomIndex = Math.floor(
                        Math.random() * platformModels.value.length
                    )
                    const selectedModel = platformModels.value[randomIndex]
                    platformName = model
                    modelName = selectedModel.name
                } else {
                    // Parse the full model name
                    ;[platformName, modelName] = parseRawModelName(model)

                    // Validate that parsing succeeded
                    if (!platformName || !modelName) {
                        context.message = session.text(
                            '.invalid_model_format',
                            [model]
                        )
                        return ChainMiddlewareRunStatus.STOP
                    }
                }

                // Get the client for the platform
                const client = await services.getClient(platformName)

                if (client.value == null) {
                    // Try to wait for the platform to load
                    await ctx.chatluna.awaitLoadPlatform(platformName, 10000)
                }

                if (client.value == null) {
                    context.message = session.text('.platform_unavailable', [
                        platformName
                    ])
                    return ChainMiddlewareRunStatus.STOP
                }

                // Create the model
                const chatModel = client.value.createModel(
                    modelName
                ) as ChatLunaChatModel

                if (!chatModel) {
                    context.message = session.text('.model_not_found', [
                        `${platformName}/${modelName}`
                    ])
                    return ChainMiddlewareRunStatus.STOP
                }

                // Test the model with a simple request
                context.message = session.text('.testing', [
                    `${platformName}/${modelName}`
                ])

                const startTime = Date.now()
                let response: AIMessageChunk
                let testError: Error | null = null

                try {
                    response = await chatModel.invoke('Hello', {
                        maxTokens: 10,
                        signal: AbortSignal.timeout(60000)
                    })
                } catch (error) {
                    testError = error
                }

                const endTime = Date.now()
                const responseTime = endTime - startTime

                if (testError) {
                    context.message = session.text('.test_failed', [
                        `${platformName}/${modelName}`,
                        responseTime.toString(),
                        testError.message || testError.toString()
                    ])
                } else if (response && response.content) {
                    context.message = session.text('.test_success', [
                        `${platformName}/${modelName}`,
                        responseTime.toString(),
                        response.content.toString().substring(0, 50)
                    ])
                } else {
                    context.message = session.text('.test_success_no_content', [
                        `${platformName}/${modelName}`,
                        responseTime.toString()
                    ])
                }
            } catch (error) {
                context.message = session.text('.test_error', [
                    error.message || error.toString()
                ])
            }

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_model')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        test_model: never
    }

    interface ChainMiddlewareContextOptions {
        model?: string
    }
}

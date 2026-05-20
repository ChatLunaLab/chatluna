import { Context, Session } from 'koishi'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../../chains/chain'
import { Config } from '../../config'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { AIMessageChunk } from '@langchain/core/messages'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'

interface TestTarget {
    platformName: string
    modelName: string
}

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('test_model', async (session, context) => {
            if (context.command !== 'test_model') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            await testModel(ctx, session, context)
            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')
}

async function testModel(
    ctx: Context,
    session: Session,
    context: ChainMiddlewareContext
) {
    try {
        const target = pickTarget(ctx, session, context)
        if (target == null) return

        const model = await getModel(ctx, session, context, target)
        if (model == null) return

        context.message = session.text('.testing', [
            `${target.platformName}/${target.modelName}`
        ])

        const result = await callModel(session, model)
        const name = `${target.platformName}/${target.modelName}`

        if (result.error) {
            context.message = session.text('.test_failed', [
                name,
                result.time.toString(),
                result.error.message || result.error.toString()
            ])
            return
        }

        if (result.response?.content) {
            context.message = session.text('.test_success', [
                name,
                result.time.toString(),
                result.response.content.toString().substring(0, 50)
            ])
            return
        }

        context.message = session.text('.test_success_no_content', [
            name,
            result.time.toString()
        ])
    } catch (error) {
        context.message = session.text('.test_error', [
            error.message || error.toString()
        ])
    }
}

function pickTarget(
    ctx: Context,
    session: Session,
    context: ChainMiddlewareContext
): TestTarget | undefined {
    const model = context.options.model

    if (!model.includes('/')) {
        const models = ctx.chatluna.platform.listPlatformModels(
            model,
            ModelType.llm
        )

        if (!models.value || models.value.length === 0) {
            context.message = session.text('.platform_not_found', [model])
            return
        }

        return {
            platformName: model,
            modelName:
                models.value[Math.floor(Math.random() * models.value.length)]
                    .name
        }
    }

    const [platformName, modelName] = parseRawModelName(model)
    if (!platformName || !modelName) {
        context.message = session.text('.invalid_model_format', [model])
        return
    }

    return { platformName, modelName }
}

async function getModel(
    ctx: Context,
    session: Session,
    context: ChainMiddlewareContext,
    target: TestTarget
) {
    const client = await ctx.chatluna.platform.getClient(target.platformName)

    if (client.value == null) {
        await ctx.chatluna.awaitLoadPlatform(target.platformName, 10000)
    }

    if (client.value == null) {
        context.message = session.text('.platform_unavailable', [
            target.platformName
        ])
        return
    }

    const model = await ctx.chatluna.createChatModel(
        target.platformName,
        target.modelName
    )

    if (model.value == null) {
        context.message = session.text('.model_not_found', [
            `${target.platformName}/${target.modelName}`
        ])
        return
    }

    return model.value
}

async function callModel(session: Session, model: ChatLunaChatModel) {
    const start = Date.now()
    let response: AIMessageChunk | undefined
    let error: Error | undefined

    try {
        response = await model.invoke('Hello', {
            maxTokens: 10,
            signal: AbortSignal.timeout(60000),
            configurable: {
                session,
                source: 'chatluna'
            }
        })
    } catch (err) {
        error = err
    }

    return {
        response,
        error,
        time: Date.now() - start
    }
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        test_model: never
    }

    interface ChainMiddlewareContextOptions {
        model?: string
    }
}

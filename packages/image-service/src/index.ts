/* eslint-disable @typescript-eslint/naming-convention */
import { Context, Logger, Schema } from 'koishi'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { HumanMessage } from '@langchain/core/messages'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-image-service')
    const plugin = new ChatLunaPlugin<ClientConfig, Config>(
        ctx,
        config,
        'image-service',
        false
    )

    ctx.on('ready', async () => {
        plugin.registerToService()
        listenModel(ctx)

        while (!ctx.chatluna.messageTransformer.has('img')) {
            await new Promise((resolve) => setTimeout(resolve, 100))
        }

        ctx.chatluna.messageTransformer.replace(
            'img',
            async (session, element, message) => {
                const images: string[] = message.additional_kwargs.images ?? []

                const url = (element.attrs.url ?? element.attrs.src) as string

                logger.debug(`image url: ${url}`)

                const readImage = async (url: string) => {
                    const response = await ctx.http(url, {
                        responseType: 'arraybuffer',
                        method: 'get',
                        headers: {
                            'User-Agent':
                                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
                        }
                    })

                    // support any text
                    let ext = url.match(/\.([^.]*)$/)?.[1]

                    if (!['png', 'jpeg'].includes(ext)) {
                        ext = 'jpeg'
                    }

                    const buffer = response.data

                    const base64 = Buffer.from(buffer).toString('base64')

                    images.push(`data:image/${ext ?? 'jpeg'};base64,${base64}`)
                }

                if (url.startsWith('data:image') && url.includes('base64')) {
                    images.push(url)
                } else {
                    try {
                        await readImage(url)
                    } catch (error) {
                        logger.warn(
                            `read image ${url} error, check your chat adapter`,
                            error
                        )
                    }
                }

                const [platform, modelName] = parseRawModelName(config.model)

                const model = await ctx.chatluna.createChatModel(
                    platform,
                    modelName
                )

                const userMessage = new HumanMessage(config.imagePrompt)

                userMessage.additional_kwargs = {
                    images
                }
                const result = await model.invoke([userMessage])

                message.content +=
                    '\n\n' +
                    config.imageInsertPrompt.replace(
                        '{img}',
                        getMessageContent(result.content)
                    )
            }
        )
    })
}

export interface Config extends ChatLunaPlugin.Config {
    model: string
    imagePrompt: string
    imageInsertPrompt: string
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        model: Schema.dynamic('model').default('无'),
        imagePrompt: Schema.string()
            .role('textarea')
            .default(
                `你现在是一个图片描述大师。你需要根据下面提供的图片，对该图片生成 200-400 字的中文描述。包括图片的主要内容和场景，里面可能包含的梗，人物等。`
            ),
        imageInsertPrompt: Schema.string()
            .role('textarea')
            .default(
                `<img>这是一些图片的描述: {img}。如果用户需要询问一些关于图片的问题，请根据上面的描述回答。如果用户没有提供图片，请忽略上面的描述。</img>`
            )
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

function listenModel(ctx: Context) {
    const getModelNames = (service: PlatformService) =>
        service.getAllModels(ModelType.llm).map((m) => Schema.const(m))

    ctx.on('chatluna/model-added', (service) => {
        ctx.schema.set('model', Schema.union(getModelNames(service)))
    })

    ctx.on('chatluna/model-removed', (service) => {
        ctx.schema.set('model', Schema.union(getModelNames(service)))
    })

    ctx.on('ready', () => {
        ctx.schema.set(
            'model',
            Schema.union(getModelNames(ctx.chatluna.platform))
        )
    })
}

export const inject = ['chatluna']

export const name = 'chatluna-image-service'

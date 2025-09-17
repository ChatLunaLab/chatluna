import { Context, Logger, Schema } from 'koishi'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import {
    HumanMessage,
    MessageContent,
    MessageContentComplex,
    MessageContentText
} from '@langchain/core/messages'
import {
    getMessageContent,
    isMessageContentImageUrl
} from 'koishi-plugin-chatluna/utils/string'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { Message } from 'koishi-plugin-chatluna'
import { modelSchema } from 'koishi-plugin-chatluna/utils/schema'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'

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
        modelSchema(ctx)

        const [platform, modelName] = parseRawModelName(config.model)
        const model = await ctx.chatluna.createChatModel(platform, modelName)

        const disposable = ctx.chatluna.messageTransformer.intercept(
            'img',
            async (session, element, message) => {
                if (model.value == null) {
                    logger.warn(
                        `The model ${modelName} is not loaded, please check your chat adapter`
                    )
                    return false
                }

                if (
                    !model.value.modelInfo.capabilities.includes(
                        ModelCapabilities.ImageInput
                    )
                ) {
                    logger.warn(
                        `The model ${modelName} in image-service does not support image input, please check your chat adapter`
                    )
                    return false
                }

                const url = (element.attrs.url ?? element.attrs.src) as string

                try {
                    const fakeMessage: Message = {
                        content: []
                    }

                    logger.debug(`image url: ${url}`)

                    const imageData = await readImage(ctx, url)

                    addImageToContent(fakeMessage, imageData.base64Source)

                    const result = await processImageWithModel(
                        model.value,
                        config,
                        fakeMessage
                    )

                    if (result) {
                        addTextToContent(message, '\n\n' + result)
                    }
                } catch (error) {
                    logger.warn(
                        `read image ${url} error, check your chat adapter`,
                        error
                    )
                }
            }
        )

        ctx.effect(() => disposable)
        logger.debug(`${plugin.platformName} loaded`)
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
                `你现在是一个图片描述大师。你需要根据下面提供的图片，对该图片或者图片列表生成 150-400 字的中文描述。包括图片的主要内容和场景，里面可能包含的梗，人物等。`
            ),
        imageInsertPrompt: Schema.string()
            .role('textarea')
            .default(
                `<img>这是一张图片的描述: {img}。如果用户需要询问一些关于图片的问题，请根据上面的描述回答。如果用户没有提供图片，请忽略上面的描述。</img>`
            )
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = ['chatluna']

export const name = 'chatluna-image-service'

async function readImage(ctx: Context, url: string) {
    if (url.startsWith('data:image') && url.includes('base64')) {
        return {
            base64Source: url,
            buffer: Buffer.from(url.split(',')[1], 'base64')
        }
    }

    const response = await ctx.http(url, {
        responseType: 'arraybuffer',
        method: 'get',
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
        }
    })

    let ext = url.match(/\.([^.]*)$/)?.[1]

    if (!['png', 'jpeg'].includes(ext)) {
        ext = 'jpeg'
    }

    const buffer = Buffer.from(response.data)
    const base64 = buffer.toString('base64')

    return {
        base64Source: `data:image/${ext ?? 'jpeg'};base64,${base64}`,
        buffer
    }
}

async function processImageWithModel(
    model: ChatLunaChatModel,
    config: Config,
    message: Message
) {
    const images = extractImages(message.content)
    console.log(images)
    if (images.length === 0) return null

    try {
        const content: MessageContentComplex[] = [
            { type: 'text', text: config.imagePrompt } as MessageContentText,
            ...images
        ]

        const result = await model.invoke([new HumanMessage({ content })])

        return config.imageInsertPrompt.replace(
            '{img}',
            getMessageContent(result.content)
        )
    } catch (error) {
        logger.warn('Failed to process image with model', error)
        return null
    }
}

const addImageToContent = (message: Message, imageUrl: string) => {
    ;(message.content as MessageContentComplex[]).push({
        type: 'image_url',
        image_url: {
            url: imageUrl
        }
    })
}

const addTextToContent = (message: Message, text: string) => {
    if (typeof message.content === 'string') {
        message.content += text
        return
    }

    const content = message.content as MessageContentComplex[]
    const lastItem = content[content.length - 1]

    if (lastItem && lastItem.type === 'text') {
        lastItem.text += text
    } else {
        content.push({
            type: 'text',
            text
        })
    }
}

const extractImages = (content: MessageContent) =>
    Array.isArray(content)
        ? content.filter((item: MessageContentComplex) =>
              isMessageContentImageUrl(item)
          )
        : []

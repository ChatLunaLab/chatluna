import { h, Schema } from 'koishi'
import {
    getMessageContent,
    transformMessageContentToElements
} from 'koishi-plugin-chatluna/utils/string'
import { transformToMarkdown } from 'koishi-plugin-chatluna/utils/koishi'
import { Message, RenderMessage, RenderOptions } from '../types'
import { BufferedRenderStreamSession, Renderer } from './base'
import { splitText } from './split'
import { RenderStreamPlan, RenderStreamSession } from './types'

export class TextRenderer extends Renderer {
    async render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage> {
        if (
            options.session != null &&
            options.session.platform === 'qq' &&
            options.session.isDirect
        ) {
            return {
                element: [
                    h.text(getMessageContent(message.content)),
                    ...h.parse('<markdown-qq></markdown-qq>')
                ]
            }
        }

        let transformed = transformMessageContentToElements(message.content)

        transformed = transformAndEscape(
            transformed,
            options.session?.platform ?? 'sandbox'
        )

        if (transformed[0]?.type === 'p') {
            const element = transformed.shift()
            const content = element.attrs['content']
            if (content) {
                transformed.unshift(h.text(content))
            } else {
                transformed.unshift(...element.children)
            }
        }

        if (options.split && options.split !== 'none') {
            transformed = transformed.flatMap((element) => {
                if (element.type !== 'text') return h('message', element)
                return splitText(element.attrs['content'], options.split).map(
                    (text) => h('message', h.text(text))
                )
            })
        }

        return {
            element: transformed
        }
    }

    getStreamPlan(options: RenderOptions): RenderStreamPlan {
        if (options.split && options.split !== 'none') return { mode: 'split' }

        const session = options.session
        const canEdit =
            session?.bot?.editMessage != null &&
            session.bot.platform !== 'onebot'

        if (canEdit) return { mode: 'edit' }
        return { mode: 'split' }
    }

    createStreamSession(
        options: RenderOptions,
        plan: RenderStreamPlan
    ): RenderStreamSession {
        return new TextStreamSession(options, plan)
    }

    schema = Schema.const('text').i18n({
        'zh-CN': '将回复作为 markdown 进行渲染',
        'en-US': 'Render as markdown'
    })
}

class TextStreamSession extends BufferedRenderStreamSession {
    constructor(options: RenderOptions, plan: RenderStreamPlan) {
        super(options, plan)
    }

    protected renderText(text: string) {
        const transformed = transformAndEscape(
            transformMessageContentToElements(text),
            this.options.session?.platform ?? 'sandbox'
        )

        if (transformed[0]?.type === 'p') {
            const element = transformed.shift()
            const content = element.attrs['content']
            if (content) {
                transformed.unshift(h.text(content))
            } else {
                transformed.unshift(...element.children)
            }
        }

        return transformed
    }
}

export function transformAndEscape(source: h[], platform: string = 'sandbox') {
    return source.flatMap((element) => {
        if (element.type === 'text') {
            return transformToMarkdown(element.attrs['content'], platform)
        }
        return element
    })
}

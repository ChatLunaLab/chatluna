import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from './default'
import { transformToMarkdown } from 'koishi-plugin-chatluna/utils/koishi'
import { h, Schema } from 'koishi'
import {
    getMessageContent,
    transformMessageContentToElements
} from 'koishi-plugin-chatluna/utils/string'

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

        if (options.split) {
            transformed = transformed.map((element) => h('message', element))
        }

        if (transformed[0]?.type === 'p') {
            const pElement = transformed.shift()
            const pElementContent = pElement.attrs['content']
            if (pElementContent) {
                transformed.unshift(h.text(pElementContent))
            } else {
                transformed.unshift(...pElement.children)
            }
        }

        return {
            element: transformed
        }
    }

    schema = Schema.const('text').i18n({
        'zh-CN': '将回复作为 markdown 进行渲染',
        'en-US': 'Render as markdown'
    })
}

export function transformAndEscape(source: h[], platform: string = 'sandbox') {
    return source.flatMap((element) => {
        if (element.type === 'text') {
            const base = transformToMarkdown(element.attrs['content'], platform)
            return base
        }
        return element
    })
}

import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from './default'
import { transform } from 'koishi-plugin-markdown'
import { h, Schema } from 'koishi'
import { removeMarkdown } from '../utils/remove-markdown'
import he from 'he'

export class PureTextRenderer extends Renderer {
    async render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage> {
        let transformed = [h.text(message.content)]

        if (options.split) {
            transformed = transformed.flatMap((element) => {
                const content = element.attrs['content'] as string

                return content.split('\n\n\n').map((paragraph) => {
                    return h.text(paragraph)
                })
            })
        }

        transformed = transformed.map((element) => {
            const content = element.attrs['content']
            return h.text(stripMarkdown(content))
        })

        return {
            element: transformed
        }
    }

    schema = Schema.const('pure-text').i18n({
        'zh-CN': '将回复渲染为纯文本（去除 markdown 格式）',
        'en-US': 'Render as pure text (remove markdown format)'
    })
}

function unescape(element: h): h {
    if (element.type === 'text') {
        element.attrs['content'] = he.decode(element.attrs['content'])
    }
    if (element.children && element.children.length > 0) {
        element.children = element.children.map(unescape)
    }
    return element
}

export function transformAndEscape(source: string) {
    const transformed = transform(source).map(unescape)

    return transformed
}

// Add a utility function that uses our removeMarkdown function
export function stripMarkdown(source: string) {
    return removeMarkdown(source)
}

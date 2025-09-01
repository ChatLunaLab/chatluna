import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from './default'
import { transform } from 'koishi-plugin-markdown'
import { h, Schema } from 'koishi'
import he from 'he'
import { transformMessageContentToElements } from 'koishi-plugin-chatluna/utils/string'

export class TextRenderer extends Renderer {
    async render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage> {
        let transformed = transformMessageContentToElements(message.content)

        transformed = transformAndEscape(transformed)

        if (options.split) {
            transformed = transformed.map((element) => {
                return h('message', element)
            })
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

function unescape(element: h): h {
    if (element.type === 'text') {
        element.attrs['content'] = he.decode(element.attrs['content'])
    }
    if (element.children && element.children.length > 0) {
        element.children = element.children.map(unescape)
    }
    return element
}

export function transformAndEscape(source: h[]) {
    return source.flatMap((element) => {
        if (element.type === 'text') {
            return transform(element.attrs['content']).map(unescape)
        }
        return unescape(element)
    })
}

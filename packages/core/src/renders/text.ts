import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from '../render'
import { transform } from 'koishi-plugin-markdown'
import { h } from 'koishi'
import he from 'he'

export default class TextRenderer extends Renderer {
    async render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage> {
        let transformed = transformAndEscape(message.content)

        if (options.split) {
            transformed = transformed.map((element) => {
                return h('message', element)
            })
        }

        return {
            element: transformed
        }
    }
}

function escape(element: h): h {
    if (element.type === 'text') {
        element.attrs['content'] = he.decode(element.attrs['content'])
    }
    if (element.children && element.children.length > 0) {
        element.children = element.children.map(escape)
    }
    return element
}

export function transformAndEscape(source: string) {
    const transformed = transform(source).map(escape)

    return transformed
}

import { Message, RenderMessage, RenderOptions } from '../types'
import { transformMessageContentToElements } from 'koishi-plugin-chatluna/utils/string'
import { Renderer } from './default'
import { h, Schema } from 'koishi'

export class RawRenderer extends Renderer {
    async render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage> {
        if (typeof message.content === 'string') {
            return {
                element: h.text(message.content)
            }
        }

        return {
            element: transformMessageContentToElements(message.content)
        }
    }

    schema = Schema.const('raw').i18n({
        'zh-CN': '原始输出',
        'en-US': 'Raw text'
    })
}

import { h, Schema } from 'koishi'
import { transformMessageContentToElements } from 'koishi-plugin-chatluna/utils/string'
import { Message, RenderMessage, RenderOptions } from '../types'
import { BufferedRenderStreamSession, Renderer } from './base'
import { RenderStreamPlan, RenderStreamSession } from './types'

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
        return new RawStreamSession(options, plan)
    }

    schema = Schema.const('raw').i18n({
        'zh-CN': '原始输出',
        'en-US': 'Raw text'
    })
}

class RawStreamSession extends BufferedRenderStreamSession {
    constructor(options: RenderOptions, plan: RenderStreamPlan) {
        super(options, plan)
    }

    protected renderText(text: string) {
        return [h.text(text)]
    }
}

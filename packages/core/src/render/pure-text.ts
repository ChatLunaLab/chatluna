import { h, Schema } from 'koishi'
import { transform } from 'koishi-plugin-markdown'
import { transformMessageContentToElements } from 'koishi-plugin-chatluna/utils/string'
import he from 'he'
import { Message, RenderMessage, RenderOptions } from '../types'
import { removeMarkdown } from '../utils/remove-markdown'
import { BufferedRenderStreamSession, Renderer } from './base'
import { splitText } from './split'
import { RenderStreamPlan, RenderStreamSession } from './types'

export class PureTextRenderer extends Renderer {
    async render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage> {
        let transformed = transformMessageContentToElements(message.content)

        if (options.split && options.split !== 'none') {
            transformed = transformed.flatMap((element) => {
                if (element.type !== 'text') return element
                const content = element.attrs['content'] as string
                return splitText(content, options.split).map((text) =>
                    h.text(text)
                )
            })
        }

        transformed = transformed.map((element) => {
            if (element.type !== 'text') return element
            return h.text(stripMarkdown(element.attrs['content']))
        })

        return {
            element: transformed
        }
    }

    getStreamPlan(options: RenderOptions): RenderStreamPlan {
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
        return new PureTextStreamSession(options, plan)
    }

    schema = Schema.const('pure-text').i18n({
        'zh-CN': '将回复渲染为纯文本（去除 markdown 格式）',
        'en-US': 'Render as pure text (remove markdown format)'
    })
}

class PureTextStreamSession extends BufferedRenderStreamSession {
    constructor(options: RenderOptions, plan: RenderStreamPlan) {
        super(options, plan)
    }

    protected renderText(text: string) {
        return [h.text(stripMarkdown(text))]
    }
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
    return transform(source).map(unescape)
}

export function stripMarkdown(source: string) {
    return removeMarkdown(source)
}

import { BaseMessageChunk } from '@langchain/core/messages'
import { h, Schema } from 'koishi'
import { logger } from 'koishi-plugin-chatluna'
import { transformMessageContentToElements } from 'koishi-plugin-chatluna/utils/string'
import { parseElements } from 'koishi-plugin-chatluna/utils/koishi'
import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from './base'
import { MessageElementSplitter } from './split'
import { RenderStreamPlan, RenderStreamSession } from './types'

export class KoishiElementRenderer extends Renderer {
    async render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage> {
        let transformed = transformMessageContentToElements(message.content)

        transformed = transformAndEscape(transformed)

        if (options.split && options.split !== 'none') {
            transformed = transformed.map((element) =>
                element.type === 'message' ? element : h('message', element)
            )
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
        return new KoishiElementStreamSession(options, plan)
    }

    schema = Schema.const('koishi-element').i18n({
        'zh-CN': '将回复作为 koishi 消息元素进行渲染',
        'en-US': 'Render as koishi message element template'
    })
}

class KoishiElementStreamSession implements RenderStreamSession {
    private text = ''
    private splitter: MessageElementSplitter

    constructor(
        private readonly options: RenderOptions,
        private readonly plan: RenderStreamPlan
    ) {
        this.splitter = new MessageElementSplitter()
    }

    write(chunk: BaseMessageChunk) {
        if (this.plan.mode === 'buffer') return null
        const text = getChunkText(chunk)
        if (!text) return null

        if (this.plan.mode === 'edit') {
            this.text += text
            return transformAndEscape([h.text(this.text + '●')])
        }

        const elements = this.splitter.writeText(text)
        return elements.length > 0 ? elements : null
    }

    flush() {
        if (this.plan.mode === 'buffer') return null
        if (this.plan.mode === 'edit' && this.text.trim()) {
            return transformAndEscape([h.text(this.text)])
        }

        const elements = this.splitter.flush()
        return elements.length > 0 ? elements : null
    }
}

function getChunkText(chunk: BaseMessageChunk) {
    const content = chunk.content
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
        .map((item) => (item.type === 'text' ? (item.text ?? '') : ''))
        .join('')
}

export function transformAndEscape(source: h[]) {
    return source.flatMap((element) => {
        if (element.type !== 'text') {
            return element
        }
        try {
            return parseElements(element.attrs['content'])
        } catch (e) {
            logger.error(e)
            return [h.text(element.attrs['content'])]
        }
    })
}

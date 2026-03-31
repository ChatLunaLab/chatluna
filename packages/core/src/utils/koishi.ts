import { ForkScope, h, Session, User } from 'koishi'
import { PromiseLikeDisposable } from 'koishi-plugin-chatluna/utils/types'
import { Marked, Token } from 'marked'
import type { MessageContent } from '@langchain/core/messages'
import { isMessageContentImageUrl } from 'koishi-plugin-chatluna/utils/langchain'
import {
    isMessageContentAudio,
    isMessageContentFileUrl,
    isMessageContentVideo
} from './langchain'

const marked = new Marked({
    tokenizer: {
        del(src) {
            const match = src.match(/^~~(?=\S)([\s\S]*?\S)~~/)

            if (match) {
                return {
                    type: 'del',
                    raw: match[0],
                    text: match[1],
                    tokens: this.lexer.inlineTokens(match[1])
                }
            }
            return null
        }
    }
})

export function forkScopeToDisposable(scope: ForkScope): PromiseLikeDisposable {
    return () => {
        scope.dispose()
    }
}

export async function checkAdmin(session: Session) {
    try {
        const tested = await session.app.permissions.test(
            'chatluna:admin',
            session
        )

        if (tested) {
            return true
        }
    } catch {}

    const user = await session.getUser<User.Field>(session.userId, [
        'authority'
    ])

    return user?.authority >= 3
}

const tagRegExp = /<(\/?)([^!\s>/]+)([^>]*?)\s*(\/?)>/

function renderInlineToken(token: Token, platform?: string): h | undefined {
    if (token.type === 'code') {
        return h(
            platform === 'discord' || platform === 'telegram'
                ? 'code-block'
                : 'code',
            {
                language: token['lang'],
                content: token.text,
                children: token.text
            }
        )
    } else if (token.type === 'codespan') {
        return h('code', {
            content: token.text,
            children: token.text
        })
    } else if (token.type === 'image') {
        return h.image(token.href)
    } else if (token.type === 'blockquote') {
        return h('text', { content: token.text + '\n' })
    } else if (token.type === 'text') {
        return h('text', { content: token.text })
    } else if (token.type === 'html') {
        const cap = tagRegExp.exec(token.text)
        if (!cap) {
            return h('text', { content: token.text })
        }
        if (cap[2] === 'img') {
            if (cap[1]) return
            const src = cap[3].match(/src="([^"]+)"/)
            if (src) return h.image(src[1])
        }
    }
}

function renderToken(token: Token, platform?: string): h | h[] {
    let children: h[] = []
    if (token['tokens'] && token['tokens'].length > 0) {
        children = render(token['tokens'], platform)
    }

    if (token.type === 'list' && platform === 'discord') {
        return h(token.ordered ? 'ol' : 'ul', render(token.items, platform))
    }

    if (children.length > 0) {
        if (token.type === 'paragraph') {
            return h('p', children)
        } else if (token.type === 'em') {
            return h('em', children)
        } else if (token.type === 'strong') {
            return h('strong', children)
        } else if (token.type === 'del') {
            return h('del', children)
        } else if (token.type === 'link') {
            return h('a', { href: token.href }, children)
        } else if (token.type === 'list_item') {
            if (!token.loose) {
                children = render(
                    token.tokens[0]?.['tokens'] ?? token.tokens,
                    platform
                )
            }

            children = token.loose ? [h('p', children)] : children

            if (platform === 'discord') {
                return h('li', children)
            }

            return children
        }

        const inlineToken = renderInlineToken(token, platform)

        if (inlineToken) return inlineToken
        else return children
    } else {
        const inlineToken = renderInlineToken(token, platform)
        if (inlineToken) return inlineToken
    }

    return h('text', { content: token.raw })
}

function render(tokens: Token[], platform?: string): h[] {
    return tokens
        .flatMap((token) => renderToken(token, platform))
        .filter(Boolean)
}

export function transformToMarkdown(source: string, platform?: string): h[]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformToMarkdown(
    source: TemplateStringsArray,
    platform: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
): h[]

export function transformToMarkdown(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    source: any,
    platform: string = 'onebot',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
) {
    if (!source) return []
    if (Array.isArray(source)) {
        source =
            args.map((arg, index) => source[index] + arg).join('') +
            source[args.length]
    }
    const result = render(marked.lexer(source), platform)
    return result
}

export function transformMessageContentToElements(content: MessageContent) {
    if (typeof content === 'string') {
        return [h.text(content)]
    }

    return content.map((message) => {
        if (isMessageContentImageUrl(message)) {
            const imageUrl = message.image_url
            return typeof imageUrl === 'string'
                ? h.image(imageUrl)
                : h.image(imageUrl.url)
        }

        if (isMessageContentFileUrl(message)) {
            return typeof message.file_url === 'string'
                ? h.file(message.file_url)
                : h.file(message.file_url.url)
        }

        if (isMessageContentAudio(message)) {
            return typeof message.audio_url === 'string'
                ? h.audio(message.audio_url)
                : h.audio(message.audio_url.url)
        }

        if (isMessageContentVideo(message)) {
            return typeof message.video_url === 'string'
                ? h.video(message.video_url)
                : h.video(message.video_url.url)
        }

        return h.text(message.text)
    })
}

export function pickForwardMessageId(element: h): string | null {
    const attrs = (element.attrs ?? {}) as Record<string, unknown>

    // Only use the common message id field used across other message APIs.
    // Keep both snake_case and camelCase for adapter compatibility.
    for (const key of ['message_id', 'messageId']) {
        const normalizedId = normalizeForwardMessageId(attrs[key])
        if (normalizedId) return normalizedId
    }

    return null
}

export function isForwardMessageElement(element: h): boolean {
    if (!element) return false
    if (element.type === 'forward') return true
    if (element.type !== 'message') return false

    return ['true', '1'].includes(String(element.attrs?.['forward']))
}

export function normalizeForwardMessageId(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value)
    }

    if (typeof value !== 'string') {
        return null
    }

    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

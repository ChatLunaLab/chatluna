import { Command, ForkScope, h, Session, User } from 'koishi'
import { PromiseLikeDisposable } from 'koishi-plugin-chatluna/utils/types'
import { Marked, Token } from 'marked'
import { Parser } from 'htmlparser2'
import type { MessageContent } from '@langchain/core/messages'
import {
    isMessageContentAudio,
    isMessageContentFileUrl,
    isMessageContentImageUrl,
    isMessageContentVideo
} from 'koishi-plugin-chatluna/utils/langchain'

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

const htmlVoidElements = new Set(
    'area base br col embed hr img input link meta source track wbr'.split(' ')
)

export function parseElements(source: string): h[]
export function parseElements(
    source: string,
    partial: true
): { elements: h[]; rest: string }
export function parseElements(source: string, partial = false) {
    const elements: h[] = []
    const stack: [h[], h[]?, number?, number?][] = [[elements]]
    let depth = 0
    let cut = -1
    let count = 0

    const append = (element: h) => {
        const current = stack[stack.length - 1][0]
        const last = current[current.length - 1]
        if (last?.type === 'text' && element.type === 'text') {
            last.attrs['content'] += element.attrs['content']
        } else {
            current.push(element)
        }
    }

    const parser = new Parser(
        {
            onopentag(name, sourceAttrs) {
                const attrs: Record<string, string | boolean> = {}
                for (const [key, value] of Object.entries(sourceAttrs)) {
                    if (key.startsWith('no-')) attrs[key.slice(3)] = false
                    else attrs[key] = value || true
                }

                const element = h(name, attrs)
                append(element)
                if (name === 'message') depth++
                if (!htmlVoidElements.has(name)) {
                    const parent = stack[stack.length - 1][0]
                    stack.push([
                        element.children,
                        parent,
                        parent.length - 1,
                        parser.startIndex
                    ])
                }
            },
            ontext(text) {
                append(h.text(text))
            },
            onclosetag(name, implied) {
                if (htmlVoidElements.has(name)) return
                const entry = stack.pop()
                if (entry?.[1] == null) return
                const empty = source
                    .slice(parser.startIndex, parser.endIndex + 1)
                    .trimEnd()
                    .endsWith('/>')
                if (implied && !empty) {
                    entry[1][entry[2]!] = h.text(
                        source.slice(entry[3], parser.startIndex)
                    )
                }
                if (name !== 'message' || depth < 1) return
                depth--
                if (depth === 0 && (!implied || empty)) {
                    cut = parser.endIndex + 1
                    count = elements.length
                }
            }
        },
        { decodeEntities: true, recognizeSelfClosing: true }
    )
    parser.end(source)

    if (!partial) return elements
    if (cut < 0) return { elements: [], rest: source }
    return { elements: elements.slice(0, count), rest: source.slice(cut) }
}

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
    } catch (error) {
        session.app.logger.debug(`checkAdmin permission test failed: ${error}`)
    }

    const user = (session as Session<User.Field>).user

    if (user == null) {
        return false
    }

    return user.authority >= 3
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

export function hideSlashGroups(root: Command): void {
    const toJSON = root.toJSON.bind(root)
    root.toJSON = () => {
        const data = toJSON()
        data.children = data.children.flatMap((child) => {
            const real = root.children.find((c) => c.name === child.name)
            return real?.config.slash === false
                ? (child.children ?? [])
                : [child]
        })
        return data
    }
}

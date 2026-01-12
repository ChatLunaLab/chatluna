import { ForkScope, h } from 'koishi'
import { PromiseLikeDisposable } from 'koishi-plugin-chatluna/utils/types'
import { Marked, Token } from 'marked'

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

const tagRegExp = /<(\/?)([^!\s>/]+)([^>]*?)\s*(\/?)>/

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
        } else if (token.type === 'list_item' && platform === 'discord') {
            if (!token.loose) {
                children = render(
                    token.tokens[0]?.['tokens'] ?? token.tokens,
                    platform
                )
            }
            return h('li', token.loose ? [h('p', children)] : children)
        }

        return children
    }

    if (token.type === 'code') {
        return h(platform === 'discord' ? 'code-block' : 'code', {
            language: token['lang'],
            content: token.text,
            children: token.text
        })
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
    return render(marked.lexer(source), platform)
}

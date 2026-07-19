import type { MarkedExtension } from 'marked'

export const relaxedStrong: MarkedExtension = {
    tokenizer: {
        emStrong(src) {
            // Accept LLM-style bold beside CJK text without consuming ***.
            const match = /^\*\*(?!\*)(?=\S)([\s\S]*?[^*\s])\*\*(?!\*)/.exec(
                src
            )
            if (!match) return false

            return {
                type: 'strong',
                raw: match[0],
                text: match[1],
                tokens: this.lexer.inlineTokens(match[1])
            }
        }
    }
}

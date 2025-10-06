import { Token } from './ast'
import { TemplateParser } from './parser'

// LRU Cache for tokenization results
class LRUCache<K, V> {
    private cache = new Map<K, V>()
    private maxSize: number

    constructor(maxSize: number) {
        this.maxSize = maxSize
    }

    get(key: K): V | undefined {
        const value = this.cache.get(key)
        if (value !== undefined) {
            // Move to end (most recently used)
            this.cache.delete(key)
            this.cache.set(key, value)
        }
        return value
    }

    set(key: K, value: V): void {
        // Delete if exists
        this.cache.delete(key)

        // Add to end
        this.cache.set(key, value)

        // Evict oldest if over size
        if (this.cache.size > this.maxSize) {
            const firstKey = this.cache.keys().next().value
            this.cache.delete(firstKey)
        }
    }

    clear(): void {
        this.cache.clear()
    }
}

// Cache for tokenization (1000 most recent templates)
const tokenizeCache = new LRUCache<string, Token[]>(1000)

/**
 * Tokenize template string into AST nodes (with caching)
 * Supports:
 * - {expression} - Variable interpolation, function calls, member access
 * - {if condition}...{elseif condition}...{else}...{/if} - Conditional blocks with multiple branches
 * - {for item in list}...{/for} - Loop blocks for array iteration
 * - {while condition}...{/while} - While loop blocks (boolean condition only)
 * - {repeat count}...{/repeat} - Repeat blocks for count-based iteration
 * - {{ - Escape sequence for literal { character
 * - }} - Escape sequence for literal } character
 */
export function tokenize(input: string): Token[] {
    // Check cache
    const cached = tokenizeCache.get(input)
    if (cached) {
        return cached
    }

    // Lexer: convert input to token stream
    const lexer = new TemplateLexer(input)
    const lexerTokens = lexer.tokenize()

    // Parser: convert token stream to AST
    const parser = new TemplateParser(lexerTokens)
    const tokens = parser.parse()

    // Cache result
    tokenizeCache.set(input, tokens)

    return tokens
}

/**
 * Clear tokenize cache (useful for testing or memory management)
 */
export function clearTokenizeCache(): void {
    tokenizeCache.clear()
}

/**
 * Template lexer token types
 */
export type TemplateLexerToken =
    | { type: 'text'; value: string }
    | { type: 'tag'; content: string } // content is what's between { and }

/**
 * Expression lexer token types
 */
export type ExpressionToken =
    | { type: 'number'; value: number }
    | { type: 'string'; value: string }
    | { type: 'identifier'; name: string }
    | { type: 'keyword'; value: 'true' | 'false' | 'null' }
    | { type: 'operator'; value: string }
    | {
          type: 'punctuation'
          value: '(' | ')' | '[' | ']' | '.' | ',' | '?' | ':'
      }
    | { type: 'eof' }

/**
 * Lexer: State-machine based tokenizer
 * Converts input string to stream of TEXT and TAG tokens
 * Handles {{ and }} escape sequences in TEXT mode
 */
class TemplateLexer {
    private input: string
    private pos = 0
    private tokens: TemplateLexerToken[] = []

    constructor(input: string) {
        this.input = input
    }

    tokenize(): TemplateLexerToken[] {
        while (!this.isAtEnd()) {
            this.scanToken()
        }
        return this.tokens
    }

    private scanToken(): void {
        const char = this.peek()

        // Check for escape sequences
        if (this.peek(2) === '{{') {
            this.addText('{')
            this.advance(2)
            return
        }
        if (this.peek(2) === '}}') {
            this.addText('}')
            this.advance(2)
            return
        }

        // Check for tag start
        if (char === '{') {
            this.scanTag()
            return
        }

        // Regular text
        this.scanText()
    }

    private scanText(): void {
        let text = ''

        while (!this.isAtEnd()) {
            const char = this.peek()
            const next2 = this.peek(2)

            // Stop at tag start or escape sequences
            if (char === '{' || next2 === '{{' || next2 === '}}') {
                break
            }

            text += char
            this.advance()
        }

        if (text) {
            this.addText(text)
        }
    }

    private scanTag(): void {
        // Consume {
        this.advance()

        // Read content until matching }
        const content = this.readTagContent()

        // Consume }
        if (this.peek() === '}') {
            this.advance()
            this.tokens.push({ type: 'tag', content })
        } else {
            // No matching }, treat as text
            this.addText('{' + content)
        }
    }

    private readTagContent(): string {
        let content = ''
        let depth = 1
        let inString = false
        let stringDelim = ''

        while (!this.isAtEnd() && depth > 0) {
            const char = this.peek()

            if (inString) {
                content += char
                this.advance()

                if (char === '\\' && !this.isAtEnd()) {
                    content += this.peek()
                    this.advance()
                } else if (char === stringDelim) {
                    inString = false
                    stringDelim = ''
                }
            } else {
                if (char === '"' || char === "'") {
                    inString = true
                    stringDelim = char
                    content += char
                    this.advance()
                } else if (char === '{') {
                    // Nested brace
                    depth++
                    content += char
                    this.advance()
                } else if (char === '}') {
                    depth--
                    if (depth > 0) {
                        content += char
                        this.advance()
                    }
                    // else: closing brace, don't add to content
                } else {
                    content += char
                    this.advance()
                }
            }
        }

        return content
    }

    private addText(value: string): void {
        // Merge consecutive text tokens
        const last = this.tokens[this.tokens.length - 1]
        if (last && last.type === 'text') {
            last.value += value
        } else {
            this.tokens.push({ type: 'text', value })
        }
    }

    private peek(count = 1): string {
        if (count === 1) {
            return this.input[this.pos] || ''
        }
        return this.input.slice(this.pos, this.pos + count)
    }

    private advance(count = 1): void {
        this.pos += count
    }

    private isAtEnd(): boolean {
        return this.pos >= this.input.length
    }
}

/**
 * Expression Lexer: Tokenizes expression strings
 * Used by ExpressionParser for parsing expressions
 */
export class ExpressionLexer {
    private input: string
    private pos = 0

    constructor(input: string) {
        this.input = input.trim()
    }

    tokenize(): ExpressionToken[] {
        const tokens: ExpressionToken[] = []

        while (!this.isAtEnd()) {
            this.skipWhitespace()
            if (this.isAtEnd()) break

            const token = this.scanToken()
            if (token) {
                tokens.push(token)
            }
        }

        tokens.push({ type: 'eof' })
        return tokens
    }

    private scanToken(): ExpressionToken | null {
        const char = this.peek()

        // String literals
        if (char === '"' || char === "'") {
            return this.scanStringLiteral()
        }

        // Number literals
        if (this.isDigit(char)) {
            return this.scanNumberLiteral()
        }

        // Identifiers and keywords
        if (this.isIdentifierStart(char)) {
            return this.scanIdentifierOrKeyword()
        }

        // Operators and punctuation
        const next2 = this.peek(2)

        // Two-character operators
        if (
            next2 === '==' ||
            next2 === '!=' ||
            next2 === '<=' ||
            next2 === '>=' ||
            next2 === '&&' ||
            next2 === '||'
        ) {
            this.advance(2)
            return { type: 'operator', value: next2 }
        }

        // Single-character operators
        if (
            char === '+' ||
            char === '-' ||
            char === '*' ||
            char === '/' ||
            char === '%' ||
            char === '<' ||
            char === '>' ||
            char === '!'
        ) {
            this.advance()
            return { type: 'operator', value: char }
        }

        // Punctuation
        if (
            char === '(' ||
            char === ')' ||
            char === '[' ||
            char === ']' ||
            char === '.' ||
            char === ',' ||
            char === '?' ||
            char === ':'
        ) {
            this.advance()
            return { type: 'punctuation', value: char }
        }

        throw new Error(`Unexpected character: ${char}`)
    }

    private scanStringLiteral(): ExpressionToken {
        const quote = this.peek()
        this.advance()
        let value = ''

        while (this.pos < this.input.length) {
            const char = this.peek()
            if (char === quote) {
                this.advance()
                return { type: 'string', value }
            } else if (char === '\\') {
                this.advance()
                const escaped = this.peek()
                switch (escaped) {
                    case 'n':
                        value += '\n'
                        break
                    case 't':
                        value += '\t'
                        break
                    case 'r':
                        value += '\r'
                        break
                    case '\\':
                        value += '\\'
                        break
                    case '"':
                        value += '"'
                        break
                    case "'":
                        value += "'"
                        break
                    default:
                        value += escaped
                }
                this.advance()
            } else {
                value += char
                this.advance()
            }
        }

        throw new Error('Unterminated string literal')
    }

    private scanNumberLiteral(): ExpressionToken {
        let value = ''

        while (this.pos < this.input.length && this.isDigit(this.peek())) {
            value += this.peek()
            this.advance()
        }

        if (this.peek() === '.') {
            value += '.'
            this.advance()
            while (this.pos < this.input.length && this.isDigit(this.peek())) {
                value += this.peek()
                this.advance()
            }
        }

        return { type: 'number', value: parseFloat(value) }
    }

    private scanIdentifierOrKeyword(): ExpressionToken {
        let name = ''

        while (
            this.pos < this.input.length &&
            this.isIdentifierPart(this.peek())
        ) {
            name += this.peek()
            this.advance()
        }

        // Check for keywords
        if (name === 'true' || name === 'false' || name === 'null') {
            return { type: 'keyword', value: name }
        }

        return { type: 'identifier', name }
    }

    private peek(count = 1): string {
        if (count === 1) {
            return this.input[this.pos] || ''
        }
        return this.input.slice(this.pos, this.pos + count)
    }

    private advance(count = 1): void {
        this.pos += count
    }

    private skipWhitespace(): void {
        while (
            this.pos < this.input.length &&
            /\s/.test(this.input[this.pos])
        ) {
            this.pos++
        }
    }

    private isAtEnd(): boolean {
        return this.pos >= this.input.length
    }

    private isDigit(char: string): boolean {
        return char >= '0' && char <= '9'
    }

    private isIdentifierStart(char: string): boolean {
        return (
            (char >= 'a' && char <= 'z') ||
            (char >= 'A' && char <= 'Z') ||
            char === '_' ||
            char === '$'
        )
    }

    private isIdentifierPart(char: string): boolean {
        return this.isIdentifierStart(char) || this.isDigit(char)
    }
}

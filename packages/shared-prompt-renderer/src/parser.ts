import { Expression, Token } from './ast'
import { ExpressionLexer, ExpressionToken, TemplateLexerToken } from './lexer'

/**
 * Parse result with collected variables
 */
export interface ParseResult {
    expression: Expression
    variables: Set<string>
}

/**
 * Parse an expression string into an AST
 * Supports:
 * - Literals: strings, numbers, booleans, null
 * - Identifiers: variable names
 * - Member access: obj.prop
 * - Index access: arr[0]
 * - Function calls: func(arg1, arg2)
 * - Binary operators: +, -, *, /, %, ==, !=, <, >, <=, >=, &&, ||
 * - Unary operators: !, -, +
 * - Conditional: condition ? true : false
 */
export function parseExpression(input: string): Expression {
    const lexer = new ExpressionLexer(input)
    const tokens = lexer.tokenize()
    const parser = new ExpressionParser(tokens)
    return parser.parse()
}

class ExpressionParser {
    private tokens: ExpressionToken[]
    private pos = 0

    constructor(tokens: ExpressionToken[]) {
        this.tokens = tokens
    }

    parse(): Expression {
        const expr = this.parseConditional()
        // Ensure we consumed all tokens except EOF
        if (this.peek().type !== 'eof') {
            throw new Error('Unexpected token after expression')
        }
        return expr
    }

    private parseConditional(): Expression {
        const expr = this.parseLogicalOr()

        const token = this.peek()
        if (token.type === 'punctuation' && token.value === '?') {
            this.advance()
            const consequent = this.parseConditional()
            const colonToken = this.peek()
            if (colonToken.type !== 'punctuation' || colonToken.value !== ':') {
                throw new Error('Expected ":" in conditional expression')
            }
            this.advance()
            const alternate = this.parseConditional()
            return {
                type: 'conditional',
                test: expr,
                consequent,
                alternate
            }
        }

        return expr
    }

    private parseLogicalOr(): Expression {
        let left = this.parseLogicalAnd()

        while (true) {
            const token = this.peek()
            if (token.type === 'operator' && token.value === '||') {
                this.advance()
                const right = this.parseLogicalAnd()
                left = { type: 'binary', operator: '||', left, right }
            } else {
                break
            }
        }

        return left
    }

    private parseLogicalAnd(): Expression {
        let left = this.parseEquality()

        while (true) {
            const token = this.peek()
            if (token.type === 'operator' && token.value === '&&') {
                this.advance()
                const right = this.parseEquality()
                left = { type: 'binary', operator: '&&', left, right }
            } else {
                break
            }
        }

        return left
    }

    private parseEquality(): Expression {
        let left = this.parseRelational()

        while (true) {
            const token = this.peek()
            if (
                token.type === 'operator' &&
                (token.value === '==' || token.value === '!=')
            ) {
                const op = token.value
                this.advance()
                const right = this.parseRelational()
                left = { type: 'binary', operator: op, left, right }
            } else {
                break
            }
        }

        return left
    }

    private parseRelational(): Expression {
        let left = this.parseAdditive()

        while (true) {
            const token = this.peek()
            if (
                token.type === 'operator' &&
                (token.value === '<=' ||
                    token.value === '>=' ||
                    token.value === '<' ||
                    token.value === '>')
            ) {
                const op = token.value
                this.advance()
                const right = this.parseAdditive()
                left = { type: 'binary', operator: op, left, right }
            } else {
                break
            }
        }

        return left
    }

    private parseAdditive(): Expression {
        let left = this.parseMultiplicative()

        while (true) {
            const token = this.peek()
            if (
                token.type === 'operator' &&
                (token.value === '+' || token.value === '-')
            ) {
                const op = token.value
                this.advance()
                const right = this.parseMultiplicative()
                left = { type: 'binary', operator: op, left, right }
            } else {
                break
            }
        }

        return left
    }

    private parseMultiplicative(): Expression {
        let left = this.parseUnary()

        while (true) {
            const token = this.peek()
            if (
                token.type === 'operator' &&
                (token.value === '*' ||
                    token.value === '/' ||
                    token.value === '%')
            ) {
                const op = token.value
                this.advance()
                const right = this.parseUnary()
                left = { type: 'binary', operator: op, left, right }
            } else {
                break
            }
        }

        return left
    }

    private parseUnary(): Expression {
        const token = this.peek()

        if (
            token.type === 'operator' &&
            (token.value === '!' || token.value === '-' || token.value === '+')
        ) {
            const op = token.value
            this.advance()
            const argument = this.parseUnary()
            return { type: 'unary', operator: op, argument }
        }

        return this.parsePostfix()
    }

    private parsePostfix(): Expression {
        let expr = this.parsePrimary()

        while (true) {
            const token = this.peek()

            if (token.type === 'punctuation' && token.value === '.') {
                // Member access: obj.prop
                this.advance()
                const propToken = this.peek()
                if (propToken.type !== 'identifier') {
                    throw new Error('Expected identifier after "."')
                }
                const property = propToken.name
                this.advance()
                expr = { type: 'member', object: expr, property }
            } else if (token.type === 'punctuation' && token.value === '[') {
                // Index access: arr[0]
                this.advance()
                const index = this.parseConditional()
                const closeBracket = this.peek()
                if (
                    closeBracket.type !== 'punctuation' ||
                    closeBracket.value !== ']'
                ) {
                    throw new Error('Expected "]"')
                }
                this.advance()
                expr = { type: 'index', object: expr, index }
            } else if (token.type === 'punctuation' && token.value === '(') {
                // Function call: can be func() or expr()
                this.advance()
                const args = this.parseArgumentList()
                const closeParen = this.peek()
                if (
                    closeParen.type !== 'punctuation' ||
                    closeParen.value !== ')'
                ) {
                    throw new Error('Expected ")"')
                }
                this.advance()

                // If expr is an identifier, use it as callee string
                // Otherwise, use the full expression as callee
                const callee = expr.type === 'identifier' ? expr.name : expr
                expr = {
                    type: 'call',
                    callee,
                    arguments: args
                }
            } else {
                break
            }
        }

        return expr
    }

    private parsePrimary(): Expression {
        const token = this.peek()

        // String literal
        if (token.type === 'string') {
            this.advance()
            return { type: 'literal', value: token.value }
        }

        // Number literal
        if (token.type === 'number') {
            this.advance()
            return { type: 'literal', value: token.value }
        }

        // Keywords (true, false, null)
        if (token.type === 'keyword') {
            this.advance()
            if (token.value === 'true') {
                return { type: 'literal', value: true }
            } else if (token.value === 'false') {
                return { type: 'literal', value: false }
            } else if (token.value === 'null') {
                return { type: 'literal', value: null }
            }
        }

        // Identifier
        if (token.type === 'identifier') {
            this.advance()
            return { type: 'identifier', name: token.name }
        }

        // Parenthesized expression
        if (token.type === 'punctuation' && token.value === '(') {
            this.advance()
            const expr = this.parseConditional()
            const closeParen = this.peek()
            if (closeParen.type !== 'punctuation' || closeParen.value !== ')') {
                throw new Error('Expected ")"')
            }
            this.advance()
            return expr
        }

        throw new Error(`Unexpected token: ${JSON.stringify(token)}`)
    }

    private parseArgumentList(): Expression[] {
        const args: Expression[] = []

        const token = this.peek()
        if (token.type === 'punctuation' && token.value === ')') {
            return args
        }

        while (true) {
            args.push(this.parseConditional())

            const nextToken = this.peek()
            if (nextToken.type === 'punctuation' && nextToken.value === ',') {
                this.advance()
            } else {
                break
            }
        }

        return args
    }

    private peek(): ExpressionToken {
        return this.tokens[this.pos] || { type: 'eof' }
    }

    private advance(): void {
        this.pos++
    }
}

/**
 * Template Parser: Recursive descent parser
 * Consumes template lexer token stream and builds AST
 * Handles control structures (if/for/while/repeat) and expressions
 */
export class TemplateParser {
    private tokens: TemplateLexerToken[]
    private pos = 0

    constructor(tokens: TemplateLexerToken[]) {
        this.tokens = tokens
    }

    parse(): Token[] {
        const ast: Token[] = []

        while (!this.isAtEnd()) {
            const token = this.parseToken()
            if (token) {
                ast.push(token)
            }
        }

        return ast
    }

    private parseToken(): Token | null {
        const current = this.peek()
        if (!current) return null

        if (current.type === 'text') {
            this.advance()
            return { type: 'text', value: current.value }
        }

        if (current.type === 'tag') {
            this.advance()
            return this.parseTag(current.content)
        }

        return null
    }

    private parseTag(content: string): Token | null {
        const trimmed = content.trim()

        // Control structures
        if (trimmed.startsWith('if ')) {
            return this.parseIfBlock(trimmed)
        }
        if (trimmed.startsWith('for ')) {
            return this.parseForBlock(trimmed)
        }
        if (trimmed.startsWith('while ')) {
            return this.parseWhileBlock(trimmed)
        }
        if (trimmed.startsWith('repeat ')) {
            return this.parseRepeatBlock(trimmed)
        }

        // Expression
        try {
            const expression = parseExpression(trimmed)
            return { type: 'expression', expression }
        } catch (e) {
            // If parsing fails, treat as text
            return { type: 'text', value: `{${content}}` }
        }
    }

    private parseIfBlock(header: string): Token {
        const condition = parseExpression(header.slice(3).trim())
        const consequent: Token[] = []
        const elseIfs: { condition: Expression; consequent: Token[] }[] = []
        let alternate: Token[] | undefined

        let currentBlock = consequent

        // Parse until {/if}
        while (!this.isAtEnd()) {
            const current = this.peek()

            if (current?.type === 'tag') {
                const tag = current.content.trim()

                if (tag === '/if') {
                    this.advance()
                    break
                } else if (tag.startsWith('elseif ')) {
                    this.advance()
                    const elseIfCondition = parseExpression(tag.slice(7).trim())
                    const elseIfBlock: Token[] = []
                    elseIfs.push({
                        condition: elseIfCondition,
                        consequent: elseIfBlock
                    })
                    currentBlock = elseIfBlock
                    continue
                } else if (tag === 'else') {
                    this.advance()
                    alternate = []
                    currentBlock = alternate
                    continue
                }
            }

            const token = this.parseToken()
            if (token) {
                currentBlock.push(token)
            }
        }

        return {
            type: 'if',
            condition,
            consequent,
            elseIfs: elseIfs.length > 0 ? elseIfs : undefined,
            alternate
        }
    }

    private parseForBlock(header: string): Token | null {
        const content = header.slice(4).trim()
        const inIndex = content.indexOf(' in ')
        if (inIndex === -1) {
            return { type: 'text', value: `{${header}}` }
        }

        const variable = content.slice(0, inIndex).trim()
        const iterableContent = content.slice(inIndex + 4).trim()
        const iterable = parseExpression(iterableContent)

        const body: Token[] = []

        while (!this.isAtEnd()) {
            const current = this.peek()

            if (current?.type === 'tag' && current.content.trim() === '/for') {
                this.advance()
                break
            }

            const token = this.parseToken()
            if (token) {
                body.push(token)
            }
        }

        return { type: 'for', variable, iterable, body }
    }

    private parseWhileBlock(header: string): Token {
        const condition = parseExpression(header.slice(6).trim())
        const body: Token[] = []

        while (!this.isAtEnd()) {
            const current = this.peek()

            if (
                current?.type === 'tag' &&
                current.content.trim() === '/while'
            ) {
                this.advance()
                break
            }

            const token = this.parseToken()
            if (token) {
                body.push(token)
            }
        }

        return { type: 'while', condition, body }
    }

    private parseRepeatBlock(header: string): Token {
        const count = parseExpression(header.slice(7).trim())
        const body: Token[] = []

        while (!this.isAtEnd()) {
            const current = this.peek()

            if (
                current?.type === 'tag' &&
                current.content.trim() === '/repeat'
            ) {
                this.advance()
                break
            }

            const token = this.parseToken()
            if (token) {
                body.push(token)
            }
        }

        return { type: 'repeat', count, body }
    }

    private peek(): TemplateLexerToken | undefined {
        return this.tokens[this.pos]
    }

    private advance(): void {
        this.pos++
    }

    private isAtEnd(): boolean {
        return this.pos >= this.tokens.length
    }
}

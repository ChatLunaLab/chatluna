import { Expression } from './ast'

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
    const parser = new ExpressionParser(input)
    return parser.parse()
}

/**
 * Parse expression and collect variables
 */
export function parseExpressionWithVariables(input: string): ParseResult {
    const parser = new ExpressionParser(input)
    const expression = parser.parse()
    const variables = new Set<string>()
    collectVariablesFromExpression(expression, variables)
    return { expression, variables }
}

function collectVariablesFromExpression(
    expr: Expression,
    variables: Set<string>
): void {
    switch (expr.type) {
        case 'identifier':
            variables.add(expr.name)
            break
        case 'member':
            collectVariablesFromExpression(expr.object, variables)
            break
        case 'index':
            collectVariablesFromExpression(expr.object, variables)
            collectVariablesFromExpression(expr.index, variables)
            break
        case 'call':
            if (typeof expr.callee === 'string') {
                variables.add(expr.callee)
            } else {
                collectVariablesFromExpression(expr.callee, variables)
            }
            expr.arguments.forEach((arg) =>
                collectVariablesFromExpression(arg, variables)
            )
            break
        case 'binary':
            collectVariablesFromExpression(expr.left, variables)
            collectVariablesFromExpression(expr.right, variables)
            break
        case 'unary':
            collectVariablesFromExpression(expr.argument, variables)
            break
        case 'conditional':
            collectVariablesFromExpression(expr.test, variables)
            collectVariablesFromExpression(expr.consequent, variables)
            collectVariablesFromExpression(expr.alternate, variables)
            break
    }
}

// Cache compiled regex
const WHITESPACE_REGEX = /\s/

class ExpressionParser {
    private input: string
    private pos = 0

    constructor(input: string) {
        this.input = input.trim()
    }

    parse(): Expression {
        return this.parseConditional()
    }

    private parseConditional(): Expression {
        const expr = this.parseLogicalOr()

        this.skipWhitespace()
        if (this.peek() === '?') {
            this.advance() // skip '?'
            const consequent = this.parseConditional()
            this.skipWhitespace()
            if (this.peek() !== ':') {
                throw new Error('Expected ":" in conditional expression')
            }
            this.advance() // skip ':'
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
            this.skipWhitespace()
            if (this.peek(2) === '||') {
                this.advance(2)
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
            this.skipWhitespace()
            if (this.peek(2) === '&&') {
                this.advance(2)
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
            this.skipWhitespace()
            const op = this.peek(2)
            if (op === '==' || op === '!=') {
                this.advance(2)
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
            this.skipWhitespace()
            const op2 = this.peek(2)
            const op1 = this.peek()

            if (op2 === '<=' || op2 === '>=') {
                this.advance(2)
                const right = this.parseAdditive()
                left = { type: 'binary', operator: op2, left, right }
            } else if (op1 === '<' || op1 === '>') {
                this.advance()
                const right = this.parseAdditive()
                left = { type: 'binary', operator: op1, left, right }
            } else {
                break
            }
        }

        return left
    }

    private parseAdditive(): Expression {
        let left = this.parseMultiplicative()

        while (true) {
            this.skipWhitespace()
            const op = this.peek()
            if (op === '+' || op === '-') {
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
            this.skipWhitespace()
            const op = this.peek()
            if (op === '*' || op === '/' || op === '%') {
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
        this.skipWhitespace()
        const op = this.peek()

        if (op === '!' || op === '-' || op === '+') {
            this.advance()
            const argument = this.parseUnary()
            return { type: 'unary', operator: op, argument }
        }

        return this.parsePostfix()
    }

    private parsePostfix(): Expression {
        let expr = this.parsePrimary()

        while (true) {
            this.skipWhitespace()
            const char = this.peek()

            if (char === '.') {
                // Member access: obj.prop
                this.advance()
                this.skipWhitespace()
                const property = this.parseIdentifierName()
                expr = { type: 'member', object: expr, property }
            } else if (char === '[') {
                // Index access: arr[0]
                this.advance()
                const index = this.parseConditional()
                this.skipWhitespace()
                if (this.peek() !== ']') {
                    throw new Error('Expected "]"')
                }
                this.advance()
                expr = { type: 'index', object: expr, index }
            } else if (char === '(') {
                // Function call: can be func() or expr()
                this.advance()
                const args = this.parseArgumentList()
                this.skipWhitespace()
                if (this.peek() !== ')') {
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
        this.skipWhitespace()
        const char = this.peek()

        // String literal
        if (char === '"' || char === "'") {
            return this.parseStringLiteral()
        }

        // Number literal
        if (this.isDigit(char)) {
            return this.parseNumberLiteral()
        }

        // Parenthesized expression
        if (char === '(') {
            this.advance()
            const expr = this.parseConditional()
            this.skipWhitespace()
            if (this.peek() !== ')') {
                throw new Error('Expected ")"')
            }
            this.advance()
            return expr
        }

        // Boolean and null literals, or identifier
        const word = this.parseIdentifierName()
        if (word === 'true') {
            return { type: 'literal', value: true }
        } else if (word === 'false') {
            return { type: 'literal', value: false }
        } else if (word === 'null') {
            return { type: 'literal', value: null }
        } else {
            return { type: 'identifier', name: word }
        }
    }

    private parseStringLiteral(): Expression {
        const quote = this.peek()
        this.advance()
        let value = ''

        while (this.pos < this.input.length) {
            const char = this.peek()
            if (char === quote) {
                this.advance()
                return { type: 'literal', value }
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

    private parseNumberLiteral(): Expression {
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

        return { type: 'literal', value: parseFloat(value) }
    }

    private parseIdentifierName(): string {
        this.skipWhitespace()
        let name = ''

        if (!this.isIdentifierStart(this.peek())) {
            throw new Error(`Unexpected character: ${this.peek()}`)
        }

        while (
            this.pos < this.input.length &&
            this.isIdentifierPart(this.peek())
        ) {
            name += this.peek()
            this.advance()
        }

        return name
    }

    private parseArgumentList(): Expression[] {
        const args: Expression[] = []

        this.skipWhitespace()
        if (this.peek() === ')') {
            return args
        }

        while (true) {
            args.push(this.parseConditional())
            this.skipWhitespace()

            if (this.peek() === ',') {
                this.advance()
            } else {
                break
            }
        }

        return args
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
            WHITESPACE_REGEX.test(this.input[this.pos])
        ) {
            this.pos++
        }
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

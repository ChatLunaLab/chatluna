// AST Node Types for Template Expression

export type Expression =
    | LiteralExpression
    | IdentifierExpression
    | MemberExpression
    | IndexExpression
    | CallExpression
    | BinaryExpression
    | UnaryExpression
    | ConditionalExpression

export interface LiteralExpression {
    type: 'literal'
    value: string | number | boolean | null
}

export interface IdentifierExpression {
    type: 'identifier'
    name: string
}

export interface MemberExpression {
    type: 'member'
    object: Expression
    property: string
}

export interface IndexExpression {
    type: 'index'
    object: Expression
    index: Expression
}

export interface CallExpression {
    type: 'call'
    callee: string | Expression
    arguments: Expression[]
}

export interface BinaryExpression {
    type: 'binary'
    operator: string
    left: Expression
    right: Expression
}

export interface UnaryExpression {
    type: 'unary'
    operator: string
    argument: Expression
}

export interface ConditionalExpression {
    type: 'conditional'
    test: Expression
    consequent: Expression
    alternate: Expression
}

// Template Token Types

export type Token =
    | TextToken
    | ExpressionToken
    | IfToken
    | ForToken
    | WhileToken
    | RepeatToken

export interface TextToken {
    type: 'text'
    value: string
}

export interface ExpressionToken {
    type: 'expression'
    expression: Expression
}

export interface IfToken {
    type: 'if'
    condition: Expression
    consequent: Token[]
    elseIfs?: { condition: Expression; consequent: Token[] }[]
    alternate?: Token[]
}

export interface ForToken {
    type: 'for'
    variable: string
    iterable: Expression
    body: Token[]
}

export interface WhileToken {
    type: 'while'
    condition: Expression
    body: Token[]
}

export interface RepeatToken {
    type: 'repeat'
    count: Expression
    body: Token[]
}

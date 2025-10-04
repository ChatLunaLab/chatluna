import { tokenize } from './lexer'
import { evaluateExpression, isTruthy } from './evaluator'
import { FunctionProvider, VariableProvider } from './types'
import { Expression, Token } from './ast'

export async function renderInternal(
    source: string,
    variables: Record<string, unknown>,
    extensions: {
        variableProviders?: VariableProvider[]
        functionProviders?: Record<string, FunctionProvider>
    },
    configurable: Record<string, unknown>,
    detectedVariables: string[],
    currentDepth: number,
    maxDepth: number
): Promise<string> {
    if (currentDepth >= maxDepth) {
        return source
    }

    // Merge variables only once at top level
    const allVariables =
        currentDepth === 0
            ? getAllVariables(variables, extensions.variableProviders)
            : variables

    const functionProviders = extensions.functionProviders ?? {}
    const tokens = tokenize(source)

    // Render tokens synchronously when possible, only parallelize async operations
    const results: string[] = []

    for (const token of tokens) {
        const result = await renderToken(
            token,
            allVariables,
            functionProviders,
            configurable,
            detectedVariables,
            currentDepth,
            maxDepth
        )
        results.push(result)
    }

    return results.join('')
}

async function renderToken(
    token: Token,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variables: Record<string, any>,
    functionProviders: Record<string, FunctionProvider>,
    configurable: Record<string, unknown>,
    detectedVariables: string[],
    currentDepth: number,
    maxDepth: number
): Promise<string> {
    if (currentDepth >= maxDepth) {
        return ''
    }

    switch (token.type) {
        case 'text':
            return token.value

        case 'expression': {
            try {
                const value = await evaluateExpression(
                    token.expression,
                    variables,
                    functionProviders,
                    configurable
                )
                collectVariables(token.expression, detectedVariables)
                return String(value ?? '')
            } catch (e) {
                return ''
            }
        }

        case 'if': {
            const condition = await isTruthy(
                token.condition,
                variables,
                functionProviders,
                configurable
            )

            collectVariables(token.condition, detectedVariables)

            const branch = condition ? token.consequent : token.alternate

            if (!branch) return ''

            // Render branch tokens sequentially
            const results: string[] = []
            for (const subToken of branch) {
                const result = await renderToken(
                    subToken,
                    variables,
                    functionProviders,
                    configurable,
                    detectedVariables,
                    currentDepth + 1,
                    maxDepth
                )
                results.push(result)
            }

            return results.join('')
        }

        case 'for': {
            const iterable = await evaluateExpression(
                token.iterable,
                variables,
                functionProviders,
                configurable
            )

            collectVariables(token.iterable, detectedVariables)

            if (!Array.isArray(iterable)) {
                return ''
            }

            const results: string[] = []

            // Optimize: reuse variable object with shallow copy + override
            for (const item of iterable) {
                // Create scoped variables efficiently
                const loopVariables = Object.create(variables)
                loopVariables[token.variable] = item

                // Render body tokens sequentially
                const bodyResults: string[] = []
                for (const subToken of token.body) {
                    const result = await renderToken(
                        subToken,
                        loopVariables,
                        functionProviders,
                        configurable,
                        detectedVariables,
                        currentDepth + 1,
                        maxDepth
                    )
                    bodyResults.push(result)
                }

                results.push(bodyResults.join(''))
            }

            return results.join('')
        }

        default:
            return ''
    }
}

function collectVariables(expr: Expression, detectedVariables: string[]): void {
    switch (expr.type) {
        case 'identifier':
            detectedVariables.push(expr.name)
            break
        case 'member':
            collectVariables(expr.object, detectedVariables)
            break
        case 'index':
            collectVariables(expr.object, detectedVariables)
            collectVariables(expr.index, detectedVariables)
            break
        case 'call':
            detectedVariables.push(expr.callee)
            expr.arguments.forEach((arg) =>
                collectVariables(arg, detectedVariables)
            )
            break
        case 'binary':
            collectVariables(expr.left, detectedVariables)
            collectVariables(expr.right, detectedVariables)
            break
        case 'unary':
            collectVariables(expr.argument, detectedVariables)
            break
        case 'conditional':
            collectVariables(expr.test, detectedVariables)
            collectVariables(expr.consequent, detectedVariables)
            collectVariables(expr.alternate, detectedVariables)
            break
    }
}

export function getAllVariables(
    variables: Record<string, unknown>,
    variableProviders: VariableProvider[] = []
): Record<string, unknown> {
    let allVariables: Record<string, unknown> = { ...variables }

    for (const provider of variableProviders) {
        const providerVariables = provider()
        allVariables = { ...allVariables, ...providerVariables }
    }

    return allVariables
}

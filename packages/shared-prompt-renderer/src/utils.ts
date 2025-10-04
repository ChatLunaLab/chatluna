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

            let branch: Token[] | undefined

            if (condition) {
                branch = token.consequent
            } else if (token.elseIfs && token.elseIfs.length > 0) {
                // Check elseif conditions
                for (const elseIf of token.elseIfs) {
                    const elseIfCondition = await isTruthy(
                        elseIf.condition,
                        variables,
                        functionProviders,
                        configurable
                    )

                    collectVariables(elseIf.condition, detectedVariables)

                    if (elseIfCondition) {
                        branch = elseIf.consequent
                        break
                    }
                }

                // If no elseif matched, use else
                if (!branch) {
                    branch = token.alternate
                }
            } else {
                branch = token.alternate
            }

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

        case 'while': {
            const results: string[] = []
            const MAX_ITERATIONS = 10000 // Safety limit

            let iterationCount = 0

            while (iterationCount < MAX_ITERATIONS) {
                const conditionValue = await isTruthy(
                    token.condition,
                    variables,
                    functionProviders,
                    configurable
                )

                collectVariables(token.condition, detectedVariables)

                if (!conditionValue) break

                // Render body tokens sequentially
                const bodyResults: string[] = []
                for (const subToken of token.body) {
                    const result = await renderToken(
                        subToken,
                        variables,
                        functionProviders,
                        configurable,
                        detectedVariables,
                        currentDepth + 1,
                        maxDepth
                    )
                    bodyResults.push(result)
                }

                results.push(bodyResults.join(''))
                iterationCount++
            }

            if (iterationCount >= MAX_ITERATIONS) {
                console.warn(
                    `While loop exceeded maximum iterations (${MAX_ITERATIONS}). Breaking to prevent infinite loop.`
                )
            }

            return results.join('')
        }

        case 'repeat': {
            const countValue = await evaluateExpression(
                token.count,
                variables,
                functionProviders,
                configurable
            )

            collectVariables(token.count, detectedVariables)

            const count = Number(countValue)
            if (isNaN(count) || count < 0) {
                console.warn(
                    `Repeat count must be a number, got: ${countValue}. Skipping repeat.`
                )
                return ''
            }

            const results: string[] = []
            const iterations = Math.floor(count)

            for (let i = 0; i < iterations; i++) {
                // Render body tokens sequentially
                const bodyResults: string[] = []
                for (const subToken of token.body) {
                    const result = await renderToken(
                        subToken,
                        variables,
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
            if (typeof expr.callee === 'string') {
                detectedVariables.push(expr.callee)
            } else {
                collectVariables(expr.callee, detectedVariables)
            }
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

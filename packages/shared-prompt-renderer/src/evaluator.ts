import { Expression } from './ast'
import { FunctionProvider } from './types'

/**
 * Evaluate an expression AST to a value
 */
export async function evaluateExpression(
    expr: Expression,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variables: Record<string, any>,
    functionProviders: Record<string, FunctionProvider>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configurable: Record<string, any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
    switch (expr.type) {
        case 'literal':
            return expr.value

        case 'identifier': {
            const value = variables[expr.name]
            if (value === undefined) {
                const func = functionProviders[expr.name]
                if (func) {
                    try {
                        return await func([], variables, configurable)
                    } catch (e) {
                        console.warn(
                            `Failed to call function "${expr.name}" as variable:`,
                            e
                        )
                        return ''
                    }
                }
                return ''
            }
            if (typeof value === 'function') {
                return value()
            }
            return value
        }

        case 'member': {
            const obj = await evaluateExpression(
                expr.object,
                variables,
                functionProviders,
                configurable
            )
            if (obj == null) return ''
            const value = obj[expr.property]
            if (typeof value === 'function') {
                return value.call(obj)
            }
            return value ?? ''
        }

        case 'index': {
            const obj = await evaluateExpression(
                expr.object,
                variables,
                functionProviders,
                configurable
            )
            const index = await evaluateExpression(
                expr.index,
                variables,
                functionProviders,
                configurable
            )
            if (obj == null) return ''
            const value = obj[index]
            if (typeof value === 'function') {
                return value.call(obj)
            }
            return value ?? ''
        }

        case 'call': {
            let func: FunctionProvider | undefined

            if (typeof expr.callee === 'string') {
                func = functionProviders[expr.callee]
                if (!func) {
                    throw new Error(`Unknown function: ${expr.callee}`)
                }
            } else {
                const callableValue = await evaluateExpression(
                    expr.callee,
                    variables,
                    functionProviders,
                    configurable
                )

                if (typeof callableValue === 'function') {
                    func = async (args, vars, cfg) => {
                        return await callableValue(...args)
                    }
                } else {
                    throw new Error(
                        `Expression is not callable: ${JSON.stringify(expr.callee)}`
                    )
                }
            }

            const args = await Promise.all(
                expr.arguments.map((arg) =>
                    evaluateExpression(
                        arg,
                        variables,
                        functionProviders,
                        configurable
                    )
                )
            )

            const stringArgs = args.map((arg) => String(arg))
            return await func(stringArgs, variables, configurable)
        }

        case 'binary': {
            const left = await evaluateExpression(
                expr.left,
                variables,
                functionProviders,
                configurable
            )
            const right = await evaluateExpression(
                expr.right,
                variables,
                functionProviders,
                configurable
            )

            switch (expr.operator) {
                case '+':
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return (left as any) + (right as any)
                case '-':
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return (left as any) - (right as any)
                case '*':
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return (left as any) * (right as any)
                case '/':
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return (left as any) / (right as any)
                case '%':
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return (left as any) % (right as any)
                case '==':
                    return left === right
                case '!=':
                    return left !== right
                case '<':
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return (left as any) < (right as any)
                case '>':
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return (left as any) > (right as any)
                case '<=':
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return (left as any) <= (right as any)
                case '>=':
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return (left as any) >= (right as any)
                case '&&':
                    return left && right
                case '||':
                    return left || right
                default:
                    throw new Error(`Unknown operator: ${expr.operator}`)
            }
        }

        case 'unary': {
            const argument = await evaluateExpression(
                expr.argument,
                variables,
                functionProviders,
                configurable
            )

            switch (expr.operator) {
                case '!':
                    return !argument
                case '-':
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return -(argument as any)
                case '+':
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return +(argument as any)
                default:
                    throw new Error(`Unknown operator: ${expr.operator}`)
            }
        }

        case 'conditional': {
            const test = await evaluateExpression(
                expr.test,
                variables,
                functionProviders,
                configurable
            )

            if (test) {
                return await evaluateExpression(
                    expr.consequent,
                    variables,
                    functionProviders,
                    configurable
                )
            } else {
                return await evaluateExpression(
                    expr.alternate,
                    variables,
                    functionProviders,
                    configurable
                )
            }
        }

        default:
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            throw new Error(`Unknown expression type: ${(expr as any).type}`)
    }
}

/**
 * Check if an expression evaluates to a truthy value
 */
export async function isTruthy(
    expr: Expression,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variables: Record<string, any>,
    functionProviders: Record<string, FunctionProvider>,
    configurable: Record<string, unknown>
): Promise<boolean> {
    const value = await evaluateExpression(
        expr,
        variables,
        functionProviders,
        configurable
    )
    return !!value
}

import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage
} from '@langchain/core/messages'
import { logger } from 'koishi-plugin-chatluna'
import {
    fetchUrl,
    getTimeDiff,
    rollDice,
    selectFromList
} from 'koishi-plugin-chatluna/utils/string'
import { PresetTemplate } from './type'
import { Time } from 'koishi'

type Token = {
    type: 'text' | 'variable' | 'function'
    value: string
    args?: string[]
}

function tokenize(input: string): Token[] {
    const tokens: Token[] = []
    let i = 0

    while (i < input.length) {
        // Find next opening brace
        const braceStart = input.indexOf('{', i)

        if (braceStart === -1) {
            // No more braces, add remaining text
            if (i < input.length) {
                tokens.push({ type: 'text', value: input.slice(i) })
            }
            break
        }

        // Add text before brace as text token
        if (braceStart > i) {
            tokens.push({ type: 'text', value: input.slice(i, braceStart) })
        }

        // Handle escaped braces {{...}}
        if (braceStart + 1 < input.length && input[braceStart + 1] === '{') {
            const endBraces = input.indexOf('}}', braceStart + 2)
            if (endBraces !== -1) {
                tokens.push({
                    type: 'text',
                    value: input.slice(braceStart, endBraces + 2)
                })
                i = endBraces + 2
                continue
            }
        }

        // Find matching closing brace (handling nested braces and strings)
        const braceEnd = findMatchingCloseBrace(input, braceStart)
        if (braceEnd === -1) {
            // No matching closing brace, treat as text
            tokens.push({ type: 'text', value: input[braceStart] })
            i = braceStart + 1
            continue
        }

        // Parse token content between braces
        const content = input.slice(braceStart + 1, braceEnd)
        const token = parseTokenContent(content)
        tokens.push(token)

        i = braceEnd + 1
    }

    return tokens
}

/**
 * Find the matching closing brace, properly handling nested braces and quoted strings
 */
function findMatchingCloseBrace(input: string, start: number): number {
    let depth = 1
    let i = start + 1
    let inString = false
    let stringDelim = ''

    while (i < input.length && depth > 0) {
        const char = input[i]

        if (!inString) {
            if (char === '"' || char === "'") {
                inString = true
                stringDelim = char
            } else if (char === '{') {
                depth++
            } else if (char === '}') {
                depth--
            }
        } else {
            // Inside string literal
            if (char === '\\' && i + 1 < input.length) {
                // Skip escaped character
                i++
            } else if (char === stringDelim) {
                inString = false
                stringDelim = ''
            }
        }

        i++
    }

    return depth === 0 ? i - 1 : -1
}

/**
 * Parse token content and return appropriate token
 * Supports: {variable}, {func:arg1::arg2}, {"string"::arg}, {func::"string"}
 */
function parseTokenContent(content: string): Token {
    const parts: string[] = []
    let i = 0

    while (i < content.length) {
        // Skip whitespace at the beginning
        while (i < content.length && /\s/.test(content[i])) {
            i++
        }

        if (i >= content.length) break

        let part = ''

        // Check if this part starts with a quote
        if (content[i] === '"' || content[i] === "'") {
            const quote = content[i]
            i++ // Skip opening quote

            // Parse quoted string with escape support
            while (i < content.length) {
                if (content[i] === '\\' && i + 1 < content.length) {
                    // Handle escape sequences
                    const nextChar = content[i + 1]
                    switch (nextChar) {
                        case 'n':
                            part += '\n'
                            break
                        case 't':
                            part += '\t'
                            break
                        case 'r':
                            part += '\r'
                            break
                        case 'b':
                            part += '\b'
                            break
                        case 'f':
                            part += '\f'
                            break
                        case 'v':
                            part += '\v'
                            break
                        case '0':
                            part += '\0'
                            break
                        case '\\':
                            part += '\\'
                            break
                        case '"':
                            part += '"'
                            break
                        case "'":
                            part += "'"
                            break
                        case '/':
                            part += '/'
                            break
                        default:
                            // For other characters, include the backslash
                            part += '\\' + nextChar
                            break
                    }
                    i += 2
                } else if (content[i] === quote) {
                    // End of quoted string
                    i++
                    break
                } else {
                    part += content[i]
                    i++
                }
            }
        } else {
            // Parse unquoted part
            while (i < content.length) {
                // Check for separator patterns
                if (content[i] === ':') {
                    if (i + 1 < content.length && content[i + 1] === ':') {
                        // Found '::' separator
                        break
                    } else if (parts.length === 0) {
                        // Found first ':' separator (function name separator)
                        break
                    }
                }

                // Handle legacy operators for first character
                if (part === '' && (content[i] === '+' || content[i] === '-')) {
                    part += content[i]
                    i++
                    continue
                }

                part += content[i]
                i++
            }
        }

        // Add the parsed part
        if (part.trim()) {
            parts.push(part.trim())
        }

        // Skip separator
        if (i < content.length && content[i] === ':') {
            if (i + 1 < content.length && content[i + 1] === ':') {
                i += 2 // Skip '::'
            } else if (parts.length === 1) {
                i++ // Skip first ':'
            }
        }
    }

    // Determine token type
    if (parts.length <= 1) {
        return {
            type: 'variable',
            value: parts[0] || content.trim()
        }
    } else {
        const [funcName, ...args] = parts
        return {
            type: 'function',
            value: funcName,
            args: args.filter((arg) => arg !== '')
        }
    }
}

export async function formatPresetTemplateString(
    rawString: string,
    inputVariables: Record<string, string | (() => string)>,
    variables: string[] = []
): Promise<string> {
    const tokens = tokenize(rawString)

    return await Promise.all(
        tokens.map(async (token) => {
            switch (token.type) {
                case 'text':
                    return token.value
                case 'variable': {
                    variables.push(token.value)
                    let value = inputVariables[token.value]
                    if (typeof value === 'function') value = value()
                    if (Promise.resolve(value) instanceof Promise) {
                        value = await value
                    }
                    let result = value

                    if (!result) {
                        result = ''
                        logger.warn(`Variable ${token.value} not found`)
                    }

                    return result
                }
                case 'function': {
                    variables.push(token.value)
                    return await evaluateFunction(
                        token.value,
                        token.args,
                        inputVariables
                    )
                }
            }
        })
    ).then((results) => results.join(''))
}

async function evaluateFunction(
    func: string,
    args: string[],
    inputVariables: Record<string, string | (() => string)>
): Promise<string> {
    // `Date`'s `.getUTC___()`, `.toUTCString()` and `.toISOString()` methods are in UTC;
    // all other methods are in local time.
    // `date` gives you the correct local datetime and UTC datetime.
    // `offsetDate` gives the local datetime when querying its UTC datetime.
    const date = new Date()
    const offsetDate = new Date(+date - date.getTimezoneOffset() * Time.minute)

    switch (func) {
        case 'time_UTC': {
            const utcOffset = args[0] ? parseInt(args[0]) : 0
            if (isNaN(utcOffset)) {
                logger.warn(`Invalid UTC offset: ${args[0]}`)
                return 'Invalid UTC offset'
            }
            // The offset is added instead of subtracted here because `Date.getTimezoneOffset()` is negative.
            const offsetDate = new Date(+date + utcOffset * Time.hour)
            return offsetDate.toISOString().replace('T', ' ').slice(0, -5)
        }
        case 'timeDiff': {
            return getTimeDiff(args[0], args[1])
        }
        case 'date':
            return offsetDate.toISOString().split('T')[0]
        case 'weekday':
            return [
                'Sunday',
                'Monday',
                'Tuesday',
                'Wednesday',
                'Thursday',
                'Friday',
                'Saturday'
            ][date.getDay()]
        case 'isotime':
            return offsetDate.toISOString().slice(11, 19)
        case 'isodate':
            return offsetDate.toISOString().split('T')[0]
        case 'random': {
            if (args.length === 2) {
                const [min, max] = args.map(Number)
                if (!isNaN(min) && !isNaN(max)) {
                    const result = Math.floor(
                        Math.random() * (max - min + 1) + min
                    ).toString()

                    return result
                }
            }
            const result = selectFromList(args.join(','), false)
            return result
        }
        case 'pick':
            return selectFromList(args.join(','), true)
        case 'roll':
            return rollDice(args[0]).toString()
        case 'url':
            return await fetchUrl(
                args[1],
                args[0],
                args[2],
                parseInt(args[3] ?? '1000')
            )
        default:
            return `{${func}${args.length ? ':' + args.join('::') : ''}}`
    }
}

export async function formatMessages(
    messages: BaseMessage[],
    variables: Record<string, string>
): Promise<BaseMessage[]> {
    return await Promise.all(
        messages.map(async (message) => {
            const content = await formatPresetTemplateString(
                message.content as string,
                variables
            )

            const messageInstance = new {
                human: HumanMessage,
                ai: AIMessage,
                system: SystemMessage
            }[message.getType()]({
                content,
                additional_kwargs: message.additional_kwargs
            })

            return messageInstance
        })
    )
}

export async function formatPresetTemplate(
    presetTemplate: PresetTemplate,
    inputVariables: Record<string, string>,
    returnVariables: boolean = false
): Promise<BaseMessage[] | [BaseMessage[], string[]]> {
    const variables: string[] = []

    // Create a deep copy of the messages array
    const formattedMessages = await Promise.all(
        presetTemplate.messages.map(async (message) => {
            const content = await formatPresetTemplateString(
                message.content as string,
                inputVariables,
                variables
            )

            const messageInstance = new {
                human: HumanMessage,
                ai: AIMessage,
                system: SystemMessage
            }[message.getType()]({
                content,
                additional_kwargs: message.additional_kwargs
            })

            return messageInstance
        })
    )

    if (returnVariables) {
        return [formattedMessages, variables]
    }

    return formattedMessages
}

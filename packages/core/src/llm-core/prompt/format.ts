import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage
} from '@langchain/core/messages'
import { logger } from 'koishi-plugin-chatluna'
import {
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
    // Initialize token array and input processing variables
    const tokens: Token[] = []
    const chars = input.split('')
    const length = chars.length
    let current = 0
    let buffer = ''

    while (current < length) {
        const char = chars[current]

        // Handle special token processing for '{' character
        if (char === '{') {
            // Check for escaped braces pattern '{{...}}'
            if (current + 1 < length && chars[current + 1] === '{') {
                // Find matching closing braces
                let j = current + 2
                while (
                    j < length - 1 &&
                    !(chars[j] === '}' && chars[j + 1] === '}')
                ) {
                    j++
                }

                // If found matching '}}', treat entire content as literal text
                if (
                    j < length - 1 &&
                    chars[j] === '}' &&
                    chars[j + 1] === '}'
                ) {
                    // Add existing buffer as text token if present
                    if (buffer) {
                        tokens.push({ type: 'text', value: buffer })
                        buffer = ''
                    }
                    // Add escaped content as text token
                    tokens.push({
                        type: 'text',
                        value:
                            '{{' + chars.slice(current + 2, j).join('') + '}}'
                    })
                    current = j + 2
                    continue
                }
            }

            // Process regular variable or function token
            if (buffer) {
                tokens.push({ type: 'text', value: buffer })
                buffer = ''
            }
            current++

            // Parse variable or function content
            let value = ''
            const args: string[] = []
            let inFunction = false

            // Continue until closing brace or end of input
            while (current < length && chars[current] !== '}') {
                // Check for function indicators
                if (
                    chars[current] === ':' ||
                    chars[current] === '+' ||
                    chars[current] === '-'
                ) {
                    inFunction = true
                    if (value) {
                        args.push(value)
                        value = ''
                    }
                    // Include operators in argument
                    if (chars[current] === '+' || chars[current] === '-') {
                        value += chars[current]
                    }
                } else if (
                    inFunction &&
                    chars[current] === ':' &&
                    chars[current + 1] === ':'
                ) {
                    // Handle argument separator
                    if (value) {
                        args.push(value)
                        value = ''
                    }
                    current++
                } else {
                    value += chars[current]
                }
                current++
            }

            // Process final value
            if (value) {
                if (inFunction) {
                    args.push(value)
                } else {
                    tokens.push({ type: 'variable', value })
                }
            }

            // Create function token if in function mode
            if (inFunction) {
                tokens.push({
                    type: 'function',
                    value: args.shift() || '',
                    args
                })
            }
        } else {
            // Accumulate regular text in buffer
            buffer += char
        }
        current++
    }

    // Add remaining buffer as text token
    if (buffer) {
        tokens.push({ type: 'text', value: buffer })
    }

    return tokens
}

export function formatPresetTemplateString(
    rawString: string,
    inputVariables: Record<string, string | (() => string)>,
    variables: string[] = []
): string {
    const tokens = tokenize(rawString)

    return tokens
        .map((token) => {
            switch (token.type) {
                case 'text':
                    return token.value
                case 'variable': {
                    variables.push(token.value)
                    let value = inputVariables[token.value]
                    if (typeof value === 'function') value = value()
                    let result = value

                    if (!result) {
                        result = ''
                        logger.warn(`Variable ${token.value} not found`)
                    }

                    return result
                }
                case 'function': {
                    variables.push(token.value)
                    return evaluateFunction(
                        token.value,
                        token.args,
                        inputVariables
                    )
                }
            }
        })
        .join('')
}

function evaluateFunction(
    func: string,
    args: string[],
    inputVariables: Record<string, string | (() => string)>
): string {
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
        default:
            return `{${func}${args.length ? ':' + args.join('::') : ''}}`
    }
}

export function formatMessages(
    messages: BaseMessage[],
    variables: Record<string, string>
): BaseMessage[] {
    return messages.map((message) => {
        const content = formatPresetTemplateString(
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
}

export function formatPresetTemplate(
    presetTemplate: PresetTemplate,
    inputVariables: Record<string, string>,
    returnVariables: boolean = false
): BaseMessage[] | [BaseMessage[], string[]] {
    const variables: string[] = []

    // Create a deep copy of the messages array
    const formattedMessages = presetTemplate.messages.map((message) => {
        const content = formatPresetTemplateString(
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

    if (returnVariables) {
        return [formattedMessages, variables]
    }

    return formattedMessages
}

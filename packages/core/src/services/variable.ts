import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage
} from '@langchain/core/messages'
import { Session, Time } from 'koishi'
import { logger } from 'koishi-plugin-chatluna'
import {
    fetchUrl,
    getTimeDiff,
    rollDice,
    selectFromList
} from 'koishi-plugin-chatluna/utils/string'
import {
    PresetTemplate,
    tokenize
} from 'koishi-plugin-chatluna/llm-core/prompt'

export type VariableFunction = (
    args: string[],
    inputVariables: Record<string, string | (() => string)>,
    session?: Session
) => Promise<string> | string

export type VariableProvider = () => Record<string, string | (() => string)>

export class PresetFormatService {
    private _functionHandlers: Record<string, VariableFunction> = {}
    private _variableProviders: VariableProvider[] = []
    private _staticVariables: Record<string, string | (() => string)> = {}

    constructor() {
        this._initBuiltinFunctions()
    }

    private _initBuiltinFunctions() {
        this._functionHandlers['time_UTC'] = (args) => {
            const date = new Date()
            const utcOffset = args[0] ? parseInt(args[0]) : 0
            if (isNaN(utcOffset)) {
                logger.warn(`Invalid UTC offset: ${args[0]}`)
                return 'Invalid UTC offset'
            }
            const offsetDate = new Date(+date + utcOffset * Time.hour)
            return offsetDate.toISOString().replace('T', ' ').slice(0, -5)
        }

        this._functionHandlers['timeDiff'] = (args) => {
            return getTimeDiff(args[0], args[1])
        }

        this._functionHandlers['date'] = () => {
            const date = new Date()
            const offsetDate = new Date(
                +date - date.getTimezoneOffset() * Time.minute
            )
            return offsetDate.toISOString().split('T')[0]
        }

        this._functionHandlers['weekday'] = () => {
            const date = new Date()
            return [
                'Sunday',
                'Monday',
                'Tuesday',
                'Wednesday',
                'Thursday',
                'Friday',
                'Saturday'
            ][date.getDay()]
        }

        this._functionHandlers['isotime'] = () => {
            const date = new Date()
            const offsetDate = new Date(
                +date - date.getTimezoneOffset() * Time.minute
            )
            return offsetDate.toISOString().slice(11, 19)
        }

        this._functionHandlers['isodate'] = () => {
            const date = new Date()
            const offsetDate = new Date(
                +date - date.getTimezoneOffset() * Time.minute
            )
            return offsetDate.toISOString().split('T')[0]
        }

        this._functionHandlers['random'] = (args) => {
            if (args.length === 2) {
                const [min, max] = args.map(Number)
                if (!isNaN(min) && !isNaN(max)) {
                    return Math.floor(
                        Math.random() * (max - min + 1) + min
                    ).toString()
                }
            }
            return selectFromList(args.join(','), false)
        }

        this._functionHandlers['pick'] = (args) => {
            return selectFromList(args.join(','), true)
        }

        this._functionHandlers['roll'] = (args) => {
            return rollDice(args[0]).toString()
        }

        this._functionHandlers['url'] = async (args) => {
            return await fetchUrl(
                args[1],
                args[0],
                args[2],
                parseInt(args[3] ?? '1000')
            )
        }
    }

    registerFunction(name: string, handler: VariableFunction): () => void {
        if (this._functionHandlers[name] != null) {
            logger.warn(
                `Function handler for ${name} already exists. It will be replaced.`
            )
        }

        this._functionHandlers[name] = handler

        return () => {
            delete this._functionHandlers[name]
        }
    }

    replaceFunction(name: string, handler: VariableFunction): () => void {
        if (this._functionHandlers[name] == null) {
            logger.warn(`Function handler for ${name} not exists.`)
        }

        this._functionHandlers[name] = handler
        return () => {
            delete this._functionHandlers[name]
        }
    }

    hasFunction(name: string): boolean {
        return this._functionHandlers[name] != null
    }

    registerVariableProvider(provider: VariableProvider): () => void {
        this._variableProviders.push(provider)

        return () => {
            const index = this._variableProviders.indexOf(provider)
            if (index !== -1) {
                this._variableProviders.splice(index, 1)
            }
        }
    }

    setVariable(name: string, value: string | (() => string)): void {
        this._staticVariables[name] = value
    }

    getVariable(name: string): string | (() => string) | undefined {
        return this._staticVariables[name]
    }

    removeVariable(name: string): void {
        delete this._staticVariables[name]
    }

    private _getAllVariables(
        inputVariables: Record<string, string | (() => string)>
    ): Record<string, string | (() => string)> {
        let allVariables = { ...this._staticVariables, ...inputVariables }

        // 合并所有变量提供器的变量
        for (const provider of this._variableProviders) {
            const providerVariables = provider()
            allVariables = { ...allVariables, ...providerVariables }
        }

        return allVariables
    }

    private async _evaluateFunction(
        func: string,
        args: string[],
        inputVariables: Record<string, string | (() => string)>,
        session?: Session
    ): Promise<string> {
        const handler = this._functionHandlers[func]
        if (handler) {
            const processedArgs = await Promise.all(
                args.map(async (arg) => {
                    return await this.formatPresetTemplateString(
                        arg,
                        inputVariables,
                        [],
                        session
                    )
                })
            )
            const result = await handler(processedArgs, inputVariables, session)
            return result
        }

        return `{${func}${args.length ? ':' + args.join('::') : ''}}`
    }

    async formatPresetTemplateString(
        rawString: string,
        inputVariables: Record<string, string | (() => string)> = {},
        variables: string[] = [],
        session?: Session
    ): Promise<string> {
        const allVariables = this._getAllVariables(inputVariables)
        const tokens = tokenize(rawString)

        const results = await Promise.all(
            tokens.map(async (token) => {
                switch (token.type) {
                    case 'text':
                        return token.value
                    case 'variable': {
                        variables.push(token.value)
                        let value = allVariables[token.value]
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
                        return await this._evaluateFunction(
                            token.value,
                            token.args,
                            allVariables,
                            session
                        )
                    }
                }
            })
        )

        return results.join('')
    }

    async formatMessages(
        messages: BaseMessage[],
        variables: Record<string, string> = {},
        session?: Session
    ): Promise<BaseMessage[]> {
        return await Promise.all(
            messages.map(async (message) => {
                const content = await this.formatPresetTemplateString(
                    message.content as string,
                    variables,
                    [],
                    session
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

    async formatPresetTemplate(
        presetTemplate: PresetTemplate,
        inputVariables: Record<string, string> = {},
        returnVariables: boolean = false,
        session?: Session
    ): Promise<BaseMessage[] | [BaseMessage[], string[]]> {
        const variables: string[] = []

        const formattedMessages = await Promise.all(
            presetTemplate.messages.map(async (message) => {
                const content = await this.formatPresetTemplateString(
                    message.content as string,
                    inputVariables,
                    variables,
                    session
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

    getFunctionNames(): string[] {
        return Object.keys(this._functionHandlers)
    }

    getVariableNames(): string[] {
        return Object.keys(this._staticVariables)
    }
}

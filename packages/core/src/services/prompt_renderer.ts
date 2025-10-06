import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage
} from '@langchain/core/messages'
import { Time } from 'koishi'
import { logger } from 'koishi-plugin-chatluna'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import {
    ChatLunaPromptRenderer,
    FunctionProvider,
    RenderOptions,
    RenderResult,
    VariableProvider
} from '@chatluna/shared-prompt-renderer'
import {
    fetchUrl,
    getMessageContent,
    getTimeDiff,
    rollDice,
    selectFromList
} from 'koishi-plugin-chatluna/utils/string'

export class ChatLunaPromptRenderService {
    private _renderer: ChatLunaPromptRenderer

    constructor() {
        this._renderer = new ChatLunaPromptRenderer()
        this._initBuiltinFunctions()
    }

    private _initBuiltinFunctions() {
        this.registerFunctionProvider('time_UTC', (args) => {
            const date = new Date()
            const utcOffset = args[0] ? parseInt(args[0]) : 0
            if (isNaN(utcOffset)) {
                logger.warn(`Invalid UTC offset: ${args[0]}`)
                return 'Invalid UTC offset'
            }
            const offsetDate = new Date(+date + utcOffset * Time.hour)
            return offsetDate.toISOString().replace('T', ' ').slice(0, -5)
        })

        this.registerFunctionProvider('timeDiff', (args) => {
            return getTimeDiff(args[0], args[1])
        })

        this.registerFunctionProvider('date', () => {
            const date = new Date()
            const offsetDate = new Date(
                +date - date.getTimezoneOffset() * Time.minute
            )
            return offsetDate.toISOString().split('T')[0]
        })

        this.registerFunctionProvider('weekday', () => {
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
        })

        this.registerFunctionProvider('isotime', () => {
            const date = new Date()
            const offsetDate = new Date(
                +date - date.getTimezoneOffset() * Time.minute
            )
            return offsetDate.toISOString().slice(11, 19)
        })

        this.registerFunctionProvider('isodate', () => {
            const date = new Date()
            const offsetDate = new Date(
                +date - date.getTimezoneOffset() * Time.minute
            )
            return offsetDate.toISOString().split('T')[0]
        })

        this.registerFunctionProvider('random', (args) => {
            if (args.length === 2) {
                const [min, max] = args.map(Number)
                if (!isNaN(min) && !isNaN(max)) {
                    return Math.floor(
                        Math.random() * (max - min + 1) + min
                    ).toString()
                }
            }
            return selectFromList(args.join(','), false)
        })

        this.registerFunctionProvider('pick', (args) => {
            return selectFromList(args.join(','), true)
        })

        this.registerFunctionProvider('roll', (args) => {
            return rollDice(args[0]).toString()
        })

        this.registerFunctionProvider('url', async (args) => {
            return await fetchUrl(
                args[1],
                args[0],
                args[2],
                parseInt(args[3] ?? '1000')
            )
        })
    }

    registerFunctionProvider(
        name: string,
        handler: FunctionProvider
    ): () => void {
        return this._renderer.registerFunctionProvider(name, handler)
    }

    registerVariableProvider(provider: VariableProvider): () => void {
        return this._renderer.registerVariableProvider(provider)
    }

    setVariable(name: string, value: string): void {
        this._renderer.setStaticVariable(name, value)
    }

    getVariable(name: string): string | undefined {
        return this._renderer.getStaticVariable(name)
    }

    removeVariable(name: string): void {
        this._renderer.removeStaticVariable(name)
    }

    async renderTemplate(
        source: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variables: Record<string, any> = {},
        options?: RenderOptions
    ): Promise<RenderResult> {
        return await this._renderer.render(source, variables, options)
    }

    async renderMessages(
        messages: BaseMessage[],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variables: Record<string, any> = {},
        options?: RenderOptions
    ): Promise<BaseMessage[]> {
        return await Promise.all(
            messages.map(async (message) => {
                const content = await this.renderTemplate(
                    getMessageContent(message.content),
                    variables,
                    options
                )

                const messageInstance = new {
                    human: HumanMessage,
                    ai: AIMessage,
                    system: SystemMessage
                }[message.getType()]({
                    content: content.text,
                    additional_kwargs: message.additional_kwargs
                })

                return messageInstance
            })
        )
    }

    async renderPresetTemplate(
        presetTemplate: PresetTemplate,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variables: Record<string, any> = {},
        options?: RenderOptions
    ): Promise<Omit<RenderResult, 'text'> & { messages: BaseMessage[] }> {
        const collectedVariables = new Set<string>()

        const formattedMessages = await Promise.all(
            presetTemplate.messages.map(async (message) => {
                const content = await this.renderTemplate(
                    getMessageContent(message.content),
                    variables,
                    options
                )

                const messageInstance = new {
                    human: HumanMessage,
                    ai: AIMessage,
                    system: SystemMessage
                }[message.getType()]({
                    content: content.text,
                    additional_kwargs: message.additional_kwargs
                })

                for (const variable of content.variables) {
                    collectedVariables.add(variable)
                }

                return messageInstance
            })
        )

        return {
            messages: formattedMessages,
            variables: Array.from(collectedVariables)
        }
    }
}

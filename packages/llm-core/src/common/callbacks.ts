import { AgentAction, AgentFinish, ChainValues, LLMResult } from './scheme';
import { v4 as uuidv4 } from "uuid"
export type CallbackEvents = "llmStart" | "llmNewToken" | "llmError" | "llmEnd" | "chainStart" | "chainError" | "chainEnd" | "toolStart" | "toolError" | "toolEnd" | "text" | "agentAction" | "agentEnd";

export type CallbackArgs = {
    llmStart: [llm: { name: string }, prompts: string[]],
    llmNewToken: [token: string],
    llmError: [err: Error],
    llmEnd: [output: LLMResult],
    chainStart: [chain: { name: string }, inputs: ChainValues],
    chainError: [err: Error],
    chainEnd: [outputs: ChainValues],
    toolStart: [tool: { name: string }, input: string],
    toolError: [err: Error],
    toolEnd: [output: string],
    text: [text: string],
    agentAction: [action: AgentAction],
    agentEnd: [finish: AgentFinish]
}


export interface CallbackHandlerInput {
    ignoreLLM?: boolean;
    ignoreChain?: boolean;
    ignoreAgent?: boolean;
}

export type Callbacks =
    | CallbackManager
    | CallbackHandler[];

export abstract class CallbackHandler
    implements CallbackHandlerInput {
    abstract name: string;

    ignoreLLM = false;

    ignoreChain = false;

    ignoreAgent = false;

    listener: Map<CallbackEvents, ((...args: CallbackArgs[CallbackEvents]) => Promise<void>)[]> = new Map()

    constructor(input?: CallbackHandlerInput) {
        if (input) {
            this.ignoreLLM = input.ignoreLLM ?? this.ignoreLLM;
            this.ignoreChain = input.ignoreChain ?? this.ignoreChain;
            this.ignoreAgent = input.ignoreAgent ?? this.ignoreAgent;
        }
    }

    copy(): CallbackHandler {
        return new (this.constructor as new (
            input?: CallbackHandlerInput
        ) => CallbackHandler)(this);
    }

    async dispatch(event: CallbackEvents, ...args: CallbackArgs[CallbackEvents]): Promise<void> {
        this.listener.get(event)?.forEach(async (func) => {
            await func(...args)
        })
    }

    on(event: CallbackEvents, func: (...args: CallbackArgs[CallbackEvents]) => Promise<void>): void {
        if (!this.listener.has(event)) {
            this.listener.set(event, [])
        }
        this.listener.get(event)?.push(func)
    }
}

export abstract class BaseCallbackManager {
    abstract addHandler(handler: CallbackHandler): void;

    abstract removeHandler(handler: CallbackHandler): void;

    abstract setHandlers(handlers: CallbackHandler[]): void;

    setHandler(handler: CallbackHandler): void {
        return this.setHandlers([handler]);
    }
}



export class CallbackManager
    extends BaseCallbackManager {
    handlers: CallbackHandler[];

    inheritableHandlers: CallbackHandler[];

    name = "callback_manager";

    private readonly _parentRunId?: string;

    constructor(parentRunId?: string) {
        super();
        this.handlers = [];
        this.inheritableHandlers = [];
        this._parentRunId = parentRunId;
    }

    async handleLLMStart(
        llm: { name: string },
        prompts: string[]
    ): Promise<void> {
        await Promise.all(
            this.handlers.map(async (handler) => {
                if (!handler.ignoreLLM) {
                    try {
                        await handler.dispatch("llmStart", llm, prompts);
                    } catch (err) {
                        console.error(
                            `Error in handler ${handler.constructor.name}, handleLLMStart: ${err}`
                        );
                    }
                }
            })
        );

    }

    async handleChainStart(
        chain: { name: string },
        inputs: ChainValues
    ): Promise<void> {
        await Promise.all(
            this.handlers.map(async (handler) => {
                if (!handler.ignoreChain) {
                    try {
                        await handler.dispatch("chainStart", chain, inputs);
                    } catch (err) {
                        console.error(
                            `Error in handler ${handler.constructor.name}, handleChainStart: ${err}`
                        );
                    }
                }
            })
        );

    }

    async handleToolStart(
        tool: { name: string },
        input: string
    ): Promise<void> {
        await Promise.all(
            this.handlers.map(async (handler) => {
                if (!handler.ignoreAgent) {
                    try {
                        await handler.dispatch("toolStart", tool, input);
                    } catch (err) {
                        console.error(
                            `Error in handler ${handler.constructor.name}, handleToolStart: ${err}`
                        );
                    }
                }
            })
        );
    }

    addHandler(handler: CallbackHandler, inherit = true): void {
        this.handlers.push(handler);
        if (inherit) {
            this.inheritableHandlers.push(handler);
        }
    }

    removeHandler(handler: CallbackHandler): void {
        this.handlers = this.handlers.filter((_handler) => _handler !== handler);
        this.inheritableHandlers = this.inheritableHandlers.filter(
            (_handler) => _handler !== handler
        );
    }

    setHandlers(handlers: CallbackHandler[], inherit = true): void {
        this.handlers = [];
        this.inheritableHandlers = [];
        for (const handler of handlers) {
            this.addHandler(handler, inherit);
        }
    }

    copy(
        additionalHandlers: CallbackHandler[] = [],
        inherit = true
    ): CallbackManager {
        const manager = new CallbackManager(this._parentRunId);
        for (const handler of this.handlers) {
            const inheritable = this.inheritableHandlers.includes(handler);
            manager.addHandler(handler, inheritable);
        }
        for (const handler of additionalHandlers) {
            if (
                // Prevent multiple copies of console_callback_handler
                manager.handlers
                    .filter((h) => h.name === "console_callback_handler")
                    .some((h) => h.name === handler.name)
            ) {
                continue;
            }
            manager.addHandler(handler, inherit);
        }
        return manager;
    }



    static async configure(
        inheritableHandlers?: Callbacks,
        localHandlers?: Callbacks,
    ): Promise<CallbackManager | undefined> {
        let callbackManager: CallbackManager | undefined;
        if (inheritableHandlers || localHandlers) {
            if (inheritableHandlers instanceof Array || !inheritableHandlers) {
                callbackManager = new CallbackManager();
                callbackManager.setHandlers(
                    Array.isArray(inheritableHandlers) ? inheritableHandlers : [],
                    true
                );
            } else {
                callbackManager = inheritableHandlers;
            }
            callbackManager = callbackManager.copy(
                Array.isArray(localHandlers)
                    ? localHandlers
                    : localHandlers?.handlers,
                false
            );
        }

        return callbackManager;
    }
}


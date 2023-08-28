export interface ChatCompletionResponse {
    choices: Array<{
        index: number;
        finish_reason: string | null;
        delta: { content?: string; role?: string };
        message: ChatCompletionResponseMessage
    }>;
    id: string;
    object: string;
    created: number;
    model: string;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface ChatCompletionResponseMessage {
    role: string,
    content?: string,
    name?: string,
    function_call?: ChatCompletionRequestMessageFunctionCall
}


export interface ChatCompletionFunctions {
    'name': string;
    'description'?: string;
    'parameters'?: { [key: string]: any; };
}

export interface ChatCompletionRequestMessageFunctionCall {
    'name'?: string;
    'arguments'?: string;
}


export type ChatCompletionResponseMessageRoleEnum = "system" | 'assistant' | 'user' | 'function'
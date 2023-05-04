/** 消息类型 */
export type MessageType = "human" | "ai" | "generic" | "system";

/** 输入的值，为k-v形式 */
export type InputValues = Record<string, any>;


export interface ChatMessage {
    text: string;
    name?: string;
    role?: string;
    type: MessageType;
}

export function createMessage(text: string, type: MessageType = "human",
    name?: string, role?: string): ChatMessage {
    return {
        text,
        type,
        name,
        role
    };
}

/**
 * 模型回复的结果
 */
export interface Generation {
    /**
     * 生成的文本
     */
    text: string;
    /*
     * 一些额外的信息
     */
    generationInfo?: Record<string, any>;
}

export type LLMResult = {
    /**
     * 模型的回复结果
     */
    generations: Generation[][];

    /**
     * 模型的额外输出信息
     */
    llmOutput?: Record<string, any>;
};


export interface ChatGeneration extends Generation {
    message: ChatMessage;
}

export interface ChatResult {
    generations: ChatGeneration[];

    llmOutput?: Record<string, any>;
}

/**
 * 基础的PromptValue
 */
export abstract class BasePromptValue {
    abstract toString(): string;

    abstract toChatMessages(): ChatMessage[];
}

export type AgentAction = {
    tool: string;
    toolInput: string;
    log: string;
};

export type AgentFinish = {
    returnValues: Record<string, any>;
    log: string;
};
export type AgentStep = {
    action: AgentAction;
    observation: string;
};


export type ChainValues = Record<string, any>;


export abstract class BaseRetriever {
    abstract getRelevantDocuments(query: string): Promise<Document[]>;
}

export abstract class BaseChatMessageHistory {
    public abstract getMessages(): Promise<ChatMessage[]>;

    public abstract addUserMessage(message: string): Promise<void>;

    public abstract addAIChatMessage(message: string): Promise<void>;

    public abstract clear(): Promise<void>;
}

export abstract class BaseCache<T = Generation[]> {
    abstract lookup(prompt: string, llmKey: string): Promise<T | null>;

    abstract update(prompt: string, llmKey: string, value: T): Promise<void>;
}

export abstract class BaseFileStore {
    abstract readFile(path: string): Promise<string>;

    abstract writeFile(path: string, contents: string): Promise<void>;
}
import { Callbacks } from './callbacks';
import { BasePromptValue } from './scheme';

/**
 * 用于解析LLM调用的输出的类
 */
export abstract class BaseOutputParser<T = unknown> {
    /**
     *
     * 解析LLM调用的输出
     * @param text - 要解析的LLM输出
     * @returns 解析后的输出
     */
    abstract parse(text: string, callbacks?: Callbacks): Promise<T>;

    async parseWithPrompt(
        text: string,
        _prompt: BasePromptValue,
        callbacks?: Callbacks
    ): Promise<T> {
        return this.parse(text, callbacks);
    }

    /**
     * 返回描述输出格式的字符串，用于给llm
     * @returns 格式说明
     * @example
     * ```json
     * {
     *  "foo": "bar"
     * }
     * ```
     */
    abstract getFormatInstructions(): string;

    /**
     * 返回唯一标识此解析器类的字符串类型键
     */
    _type(): string {
        throw new Error("_type not implemented");
    }
}

export class OutputParserException extends Error {
    output?: string;

    constructor(message: string, output?: string) {
        super(message);
        this.output = output;
    }
}
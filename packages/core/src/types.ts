import { inflate } from 'zlib';

export type UUID = string;

export interface SimpleMessage {

    /**
     * 消息内容
     * @type {string}
     * @memberof Message
     * */
    content: string;

    /**
     * 注入的数据支持
     * @type {string}
     */
    inject?: string;

    /**
      * 消息角色
      * @memberof Message
      * */
    role: 'user' | 'model' | 'system'

    /**
     * 消息发送者
     */
    sender?: string;
}

export interface Message extends SimpleMessage {
    /**
     * 消息ID
     * @type {UUID}
     * @memberof Message
     * */
    id: UUID;


    /**
     * 消息发送时间
     * @type {number}
     * @memberof Message
     */
    time: number;

    /**
     * 附加消息回复
     */
    additionalReplyMessages?: SimpleMessage[]
}


export type EventListener = (conversation: Conversation, message?: Message) => Promise<void>
export type Disposed = () => void;


export interface SimpleConversation {
    /**
   * 会话ID
   * @type {UUID}
   * @memberof Conversation
   **/
    id: UUID;


    /**
     * 最后一条由用户发送的消息
     */
    latestMessages: [Message, Message]

    /**
     * 消息列表
     **/
    messages: Record<UUID, Message>

    /**
     * 会话信息
     */
    config: ConversationConfig
}

/**
 * 会话信息
 */
export abstract class Conversation implements SimpleConversation {

    abstract id: UUID;
    abstract latestMessages: [Message, Message]
    abstract messages: Record<UUID, Message>
    abstract config: ConversationConfig

    /**
     * 事件监听
     */
    abstract on(event: Conversation.Events, listener: EventListener): Disposed

    /**
     * 重置对话
     */
    abstract clear(): void;

    /**
     * 初始化对话
     */
    abstract init(config: ConversationConfig): Promise<void>;

    /**
     * 询问模型，但是可以自定义发送者等信息
     */
    abstract ask(message: SimpleMessage): Promise<Message>

    /**
     * 继续上一次的询问
     * @returns {Promise<Message>}
     *
     */
    abstract continue(): Promise<Message>;

    /**
     * 重试上一次的询问
     */
    abstract retry(): Promise<Message>;


    asSimpleConversation(): SimpleConversation {
        return {
            id: this.id,
            latestMessages: this.latestMessages,
            messages: this.messages,
            config: this.config
        }
    }

    /**
     * 编辑某一条消息,这将会重置后面的消息并且让模型重新回答
     * @param message 消息
     */
    // edit(message: Message): Promise<Message>;


    /**
     * 复制会话
     */
    // fork(): Conversation;
}

export namespace Conversation {
    export type Events = 'init' | 'send' | 'receive' | 'clear' | 'retry' | 'all'
}

export interface InjectData {
    /**
     * 注入的数据
     * @type {string}
     * @memberof InjectData
     * */
    data: string;

    /**
      * 标题
      * @type {string}
      * @memberof InjectData
      */
    title?: string;

    /**
     * 来源
     * @type {string}
     * @memberof InjectData
     * */
    source?: string;
}

export interface ConversationConfig {
    /**
     * 对话适配器的标签
     */
    adapterLabel?: string;
    /**
     * 初始化的提示信息
     */
    initialPrompts?: Message | Message[];

    /**
     * 是否允许注入信息到对话中（实现网络搜索等）
     */
    inject?: boolean;
}

import { Context, Session, h } from 'koishi';
import { Config } from './config';
import { LLMChatAdapter } from './services/chatService';

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
     */
    inject?: InjectData[];

    /**
      * 消息角色
      * @memberof Message
      * */
    role: 'user' | 'model' | 'system'

    /**
     * 消息发送者
     */
    sender?: string;

    /**
     * 附加的东西
     */
    extra?: Record<string, any>;
}

export interface Message extends SimpleMessage {
    /**
    * 消息ID
    * @type {UUID}
    * @memberof Message
    * */
    parentId?: UUID;

    /**
     * 消息ID
     * @type {UUID}
     * @memberof Message
     * */
    id?: UUID;


    /**
     * 消息发送时间
     * @type {number}
     * @memberof Message
     */
    time?: number;

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
    latestMessages?: [Message, Message]

    /**
     * 消息列表
     **/
    messages?: Record<UUID, Message>

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
    abstract supportInject: boolean
    abstract concurrentMaxSize: number

    /**
     * 事件监听
     */
    abstract on(event: Conversation.Events, listener: EventListener): Disposed

    /**
     * 重置对话
     */
    abstract clear(): Promise<void>;

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

    /**
     * 等待所有的聊天请求完成，然后执行操作
     * @param fn 目标函数
     * @param lock 是否锁定，锁定后所有的请求都会被阻塞
     */
    abstract wait(fn: () => Promise<void>, lock: boolean): Promise<void>;

    /**
     * 转换为简单的会话，用于序列化
     */
    asSimpleConversation(): SimpleConversation {
        return {
            id: this.id,
            latestMessages: this.latestMessages,
            messages: this.messages,
            config: this.config
        }
    }


    export(type: "json" | "markdown"): string {
        switch (type) {
            case "json":
                // pick: id,latestMessages,messages 
                return JSON.stringify({
                    id: this.id,
                    latestMessages: this.latestMessages,
                    messages: this.messages
                })
            case "markdown":
                return this.exportAsMarkdown()
            default:
                throw new Error("不支持的导出类型")
        }
    }


    exportAsMarkdown(): string {
        const messages = Object.values(this.messages)

        const result = messages.map(message => {
            const content = message.content
            const sender = message.sender


            const additionalReplyMessages = message.additionalReplyMessages

            const additionalReplyMessagesString = additionalReplyMessages ? additionalReplyMessages.map(message => {
                return `> ${message.content}`
            }).join("\n") : ""

            return `${sender ? `**${sender}**:` : ""}${content}\n${additionalReplyMessagesString}`

        }).join("\n")

        return result
    }


    abstract import(jsonText: string): Promise<void>

    /**
     * 获取适配器
     */
    abstract getAdapter(): LLMChatAdapter
}

export namespace Conversation {
    export type Events = 'init' | 'send' | 'receive' | 'clear' | 'retry' | 'all' | 'before-send'
    export type InjectType = 'none' | 'default' | 'enhanced'
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
    initialPrompts?: SimpleMessage | SimpleMessage[];

    /**
     * 是否允许注入信息到对话中（实现网络搜索等）
     */
    inject?: Conversation.InjectType

    /**
     * 人格ID
     */
    personalityId?: string

    formatUserPrompt?: string
}


export interface ConversationId {
    /**
     * 会话ID
     * @type {UUID}
     **/
    id: UUID;

    /**
     * 适配器标签
     */
    adapterLabel?: string;
}

export interface SenderInfo {
    /**
     * 发送者
     **/
    senderName: string;

    /*
        * 会话ID
    **/
    senderId: string;

    /*
    *用户ID
    **/
    userId: string;
}


/**
 * 渲染参数
 */
export interface RenderOptions {
    // 如果type为voice，那么这个值不可为空
    voice?: {
        speakerId?: number
    }
    split?: boolean
    type: RenderType
}


export interface RenderMessage {
    element: h | h[]
}

export type RenderType = "raw" | "voice" | "text" | "image" | "mixed"


export interface ChatOptions {
    ctx: Context,
    session: Session,
    config: Config
    model?: {
        needInjectData?: boolean,
        conversationConfig?: ConversationConfig
    }
    render?: RenderOptions
}
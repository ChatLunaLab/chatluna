/** @module sub-agent/task_attach */

import { Context, Session } from 'koishi'
import { randomUUID } from 'crypto'
import type { ConversationRecord } from 'koishi-plugin-chatluna/services/chat'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { logger } from '..'

interface TaskAttachState {
    taskId: string
    parentConversationId: string
    lastActiveAt: number
}

export class ChatLunaAgentTaskAttachService {
    private _items = new Map<string, TaskAttachState>()

    constructor(public ctx: Context) {
        ctx.middleware(async (session, next) => {
            const key = this.key(session)
            const item = this._items.get(key)
            if (!item) return next()

            if (Date.now() - item.lastActiveAt > 10 * 60 * 1000) {
                this._items.delete(key)
                await session.send('Sub-agent attach expired.')
                return next()
            }

            if (session.argv?.command) return next()

            const task = this.ctx.chatluna_agent?.subAgent.getTask(item.taskId)
            if (!task) {
                this._items.delete(key)
                await session.send('Sub-agent task was not found or expired.')
                return
            }

            item.lastActiveAt = Date.now()
            const conversation =
                await this.ctx.chatluna.conversation.getConversation(
                    item.parentConversationId
                )
            if (!conversation) {
                this._items.delete(key)
                await session.send(
                    'Parent conversation is no longer available.'
                )
                return
            }

            try {
                const result = await this.ctx.chatluna_agent.subAgent.chatTask(
                    item.taskId,
                    session.content,
                    {
                        session,
                        runConfig: await this.runConfig(session, conversation)
                    }
                )

                if (result.state === 'queued') {
                    await session.send(
                        `Delivered to running sub-agent ${task.agentName} (${task.id.slice(0, 8)}).`
                    )
                    return
                }

                await session.send(result.output?.trim() || '(empty)')
            } catch (err) {
                this._items.delete(key)
                logger.error(err)
                await session.send('Sub-agent task failed, please retry.')
                return next()
            }
        })

        ctx.on('chatluna/chat-stopped', async ({ conversationId }) => {
            this.detachConversation(conversationId)
        })
        ctx.on(
            'chatluna/before-conversation-clear-history',
            async ({ conversation }) => {
                this.detachConversation(conversation.id)
            }
        )
        ctx.setInterval(() => {
            const now = Date.now()
            for (const [key, item] of this._items.entries()) {
                if (now - item.lastActiveAt > 10 * 60 * 1000) {
                    this._items.delete(key)
                }
            }
        }, 60 * 1000)
    }

    attach(session: Session, taskId: string, parentConversationId: string) {
        this._items.set(this.key(session), {
            taskId,
            parentConversationId,
            lastActiveAt: Date.now()
        })
    }

    detach(session: Session) {
        return this._items.delete(this.key(session))
    }

    detachTask(taskId: string) {
        for (const [key, item] of this._items.entries()) {
            if (item.taskId === taskId) this._items.delete(key)
        }
    }

    detachConversation(conversationId: string) {
        for (const [key, item] of this._items.entries()) {
            if (item.parentConversationId === conversationId) {
                this._items.delete(key)
            }
        }
    }

    private key(session: Session) {
        return [
            session.platform,
            session.selfId,
            session.channelId ?? session.userId,
            session.userId
        ].join(':')
    }

    private async runConfig(
        session: Session,
        conversation: ConversationRecord
    ) {
        const model = await this.ctx.chatluna.createChatModel(
            conversation.model
        )
        return {
            configurable: {
                model: model.value,
                session,
                preset: conversation.preset,
                agentContext: {
                    kind: 'main',
                    agentId: conversation.id,
                    agentName: conversation.preset,
                    conversationId: conversation.id,
                    requestId: randomUUID(),
                    source: 'chatluna',
                    userId: session.userId,
                    guildId: session.guildId,
                    channelId: session.channelId
                }
            }
        } as ChatLunaToolRunnable
    }
}

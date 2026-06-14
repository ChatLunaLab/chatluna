import { randomUUID } from 'crypto'

import { HumanMessage } from '@langchain/core/messages'
import { Context, h, Universal } from 'koishi'
import { buildVirtualSession } from 'koishi-plugin-chatluna/utils/virtual_session'
import type { Config } from '../../config'
import {
    type AgentTaskFinishedPayload,
    formatAgentTaskWakeup
} from './sub-agent'

export function applyAgentTaskWakeup(ctx: Context, config: Config) {
    ctx.on('chatluna/agent-task-finished', async (payload) => {
        if (!config.agentTaskAutoWakeup) return
        if (payload.run.background !== true) return
        if (payload.run.state === 'aborted') return
        if (payload.source !== 'chatluna') return
        if (payload.parentConversationId.startsWith('subagent:')) return

        const conversation = await ctx.chatluna.conversation.getConversation(
            payload.parentConversationId
        )
        if (conversation == null) return

        const content = formatAgentTaskWakeup(
            payload.taskId,
            payload.agentName,
            payload.run
        )
        const msg = new HumanMessage({ content, name: 'task' })

        if (
            conversation.chatMode === 'plugin' &&
            (await ctx.chatluna.conversationRuntime.appendPendingMessage(
                payload.parentConversationId,
                msg,
                conversation.chatMode
            ))
        ) {
            return
        }

        const session = restoreSession(ctx, payload)
        if (session == null) {
            ctx.logger.warn(
                'agent task %s finished but bot %s:%s is offline; result kept until TTL.',
                payload.taskId,
                payload.snapshot?.routing?.platform,
                payload.snapshot?.routing?.selfId
            )
            return
        }

        const resolved = await ctx.chatluna.conversation.resolveConversation(
            session,
            {
                mode: 'active',
                bindingKey:
                    payload.snapshot?.bindingKey ?? conversation.bindingKey,
                conversationId: conversation.id
            }
        )
        if (resolved.conversation == null) return

        await ctx.chatluna.chatChain.receiveCommand(session, 'chat', {
            message: [h.text(content)],
            messageId: randomUUID(),
            conversation: resolved,
            triggerWakeup: {
                requestId: randomUUID(),
                source: {
                    kind: 'agent-task',
                    detail: {
                        taskId: payload.taskId,
                        runId: payload.run.runId,
                        agent: payload.agentName,
                        state: payload.run.state
                    }
                }
            },
            inputMessage: { content, name: 'task' }
        })
    })
}

function restoreSession(ctx: Context, payload: AgentTaskFinishedPayload) {
    const live = payload.snapshot?.session
    if (live?.bot?.status === Universal.Status.ONLINE) return live

    const routing = payload.snapshot?.routing
    if (routing == null) return undefined

    const bot = ctx.bots[`${routing.platform}:${routing.selfId}`]
    if (bot == null || bot.status !== Universal.Status.ONLINE) return undefined

    return buildVirtualSession(
        bot,
        { ...routing, username: 'task' },
        { message: '', messageName: 'task' }
    )
}

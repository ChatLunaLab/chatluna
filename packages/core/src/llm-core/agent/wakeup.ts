import { HumanMessage } from '@langchain/core/messages'
import { Context, Universal } from 'koishi'
import type { Config } from '../../config'
import { formatAgentTaskWakeup } from './sub-agent'

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

        const live = payload.snapshot?.session
        const routing = payload.snapshot?.routing
        if (live == null && routing == null) {
            ctx.logger.warn(
                'agent task %s finished without a delivery target.',
                payload.taskId
            )
            return
        }

        const result = await ctx.chatluna.invoke({
            session:
                live?.bot.status === Universal.Status.ONLINE ? live : undefined,
            routing,
            message: content,
            messageName: 'task',
            conversation: { type: 'existing', id: conversation.id },
            delivery: 'channel',
            source: {
                kind: 'agent-task',
                id: payload.taskId,
                detail: {
                    runId: payload.run.runId,
                    agent: payload.agentName,
                    state: payload.run.state
                }
            }
        })
        if (!result.ok) {
            ctx.logger.warn(
                'agent task %s wakeup failed: %s',
                payload.taskId,
                result.error?.message
            )
        }
    })
}

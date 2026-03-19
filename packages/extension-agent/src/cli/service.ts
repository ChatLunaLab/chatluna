/** @module cli/service */

import { SystemMessage } from '@langchain/core/messages'
import {
    countMessageTokens,
    PromptContextRuntime
} from 'koishi-plugin-chatluna/llm-core/prompt'
import { Context, Session } from 'koishi'
import { getConfigPath } from '../config/path'
import type { ChatLunaAgentService } from '../service'
import { runAgentCliBlock } from './dispatch'
import { parseAgentCliCommand } from './parser'
import { renderAgentCliPrompt, renderAgentCliResult } from './render'
import type { AgentCliOverview, AgentCliSessionState } from './types'

const SKILL_NAME = 'agent-config-admin'

export class ChatLunaAgentCliService {
    private _promptDispose?: () => void
    private _sessions = new Map<string, AgentCliSessionState>()

    constructor(
        private ctx: Context,
        private getAgent: () => ChatLunaAgentService
    ) {
        this.ctx.on('chatluna/clear-chat-history', async (conversationId) => {
            const prefix = `${conversationId}\n`
            for (const key of this._sessions.keys()) {
                if (key.startsWith(prefix)) {
                    this._sessions.delete(key)
                }
            }
        })
    }

    async start() {
        this.syncPrompt()
    }

    async stop() {
        this._promptDispose?.()
        this._promptDispose = undefined
        this._sessions.clear()
    }

    isActive(conversationId: string) {
        return this.getAgent().skills.hasActiveSkill(conversationId, SKILL_NAME)
    }

    async executeCommand(
        command: string,
        conversationId: string,
        session: Session
    ) {
        if (!this.isActive(conversationId)) {
            throw new Error(`${SKILL_NAME} is not active in this conversation`)
        }

        const block = parseAgentCliCommand(command)
        if (!block) {
            throw new Error('Command must start with agentctl')
        }

        const state = this.getState(conversationId, session)
        const result = await runAgentCliBlock(
            {
                agent: this.getAgent(),
                conversationId,
                session,
                state
            },
            block
        )
        return renderAgentCliResult(result)
    }

    private syncPrompt() {
        this._promptDispose?.()
        this._promptDispose = this.ctx.chatluna.contextManager.pipeline(
            'after_system_prompts',
            async (runtime: PromptContextRuntime, next) => {
                const conversationId = runtime.configurable?.conversationId
                const session = runtime.configurable?.session
                if (!conversationId || !session) {
                    return next()
                }

                if (!this.isActive(conversationId)) {
                    return next()
                }

                const msg = new SystemMessage(
                    renderAgentCliPrompt(
                        this.getState(conversationId, session),
                        this.getOverview()
                    )
                )
                runtime.result.push(msg)
                runtime.usedTokens += await countMessageTokens(
                    msg,
                    runtime.tokenCounter
                )
                return next()
            },
            11
        )
    }

    private getOverview() {
        const agent = this.getAgent()
        const status = agent.getStatus()
        return {
            skill: SKILL_NAME,
            configPath: getConfigPath(agent.ctx),
            version: agent.args.config.version,
            skills: status.skills.total,
            subAgents: status.subAgent.total,
            tools: status.tool.total,
            mcpServers: Object.keys(status.mcp.servers).length,
            mcpTools: Object.keys(status.mcp.tools).length,
            computerBackends: agent.computer.listAvailableBackends()
        } satisfies AgentCliOverview
    }

    private getState(conversationId: string, session: Session) {
        const key = `${conversationId}\n${session.userId}`
        const current = this._sessions.get(key)
        if (current) {
            current.updatedAt = Date.now()
            return current
        }

        const state = {
            conversationId,
            userId: session.userId,
            permissions: ['read', 'write', 'dangerous'],
            updatedAt: Date.now()
        } satisfies AgentCliSessionState
        this._sessions.set(key, state)
        return state
    }
}

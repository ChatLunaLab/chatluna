/** @module cli/service */

import { SystemMessage } from '@langchain/core/messages'
import {
    countMessageTokens,
    PromptContextRuntime
} from 'koishi-plugin-chatluna/llm-core/prompt'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { Context, Session } from 'koishi'
import { getRemoteSkillsRoot } from '../computer/materialize'
import {
    getConfigPath,
    getSkillsRootPath,
    getSubAgentsRootPath
} from '../config/path'
import type { ChatLunaAgentService } from '../service'
import { runAgentCliBlock } from './dispatch'
import { parseAgentCliCommand } from './parser'
import { renderAgentCliPrompt, renderAgentCliResult } from './render'
import { AgentCliTool } from './tool'
import {
    AGENTCLI_PROMPT_MARKER,
    AGENTCLI_SANDBOX_SUBAGENTS_ROOT,
    AGENTCLI_SKILL_NAME,
    AGENTCLI_TOOL_NAME,
    type AgentCliOverview,
    type AgentCliSessionState
} from './types'

export class ChatLunaAgentCliService {
    private _promptDispose?: () => void
    private _toolDispose?: () => void
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
        this.syncTool()
        this.syncPrompt()
    }

    async stop() {
        this._toolDispose?.()
        this._toolDispose = undefined
        this._promptDispose?.()
        this._promptDispose = undefined
        this._sessions.clear()
    }

    isActive(conversationId: string) {
        return this.getAgent().skills.hasActiveSkill(
            conversationId,
            AGENTCLI_SKILL_NAME
        )
    }

    async executeCommand(
        command: string,
        conversationId: string,
        session: Session
    ) {
        if (!this.isActive(conversationId)) {
            throw new Error(
                `${AGENTCLI_SKILL_NAME} is not active in this conversation`
            )
        }

        const block = parseAgentCliCommand(command)
        if (!block) {
            throw new Error('Command must start with agentcli')
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

    private syncTool() {
        this._toolDispose?.()
        this._toolDispose = undefined

        const tool = new AgentCliTool(this)
        this._toolDispose = this.ctx.chatluna.platform.registerTool(
            AGENTCLI_TOOL_NAME,
            {
                description: tool.description,
                createTool: () => new AgentCliTool(this),
                selector: (history) => {
                    return history.some((msg) =>
                        getMessageContent(msg.content).startsWith(
                            AGENTCLI_PROMPT_MARKER
                        )
                    )
                },
                meta: {
                    source: 'extension',
                    group: 'agent',
                    tags: ['config'],
                    defaultAvailability: {
                        enabled: true,
                        main: true,
                        chatluna: true,
                        characterScope: 'all'
                    }
                }
            }
        )
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
            skill: AGENTCLI_SKILL_NAME,
            configPath: getConfigPath(agent.ctx),
            localSkillsDir: getSkillsRootPath(agent.ctx),
            localSubAgentsDir: getSubAgentsRootPath(agent.ctx),
            sandboxSkillsDir: getRemoteSkillsRoot(),
            sandboxSubAgentsDir: AGENTCLI_SANDBOX_SUBAGENTS_ROOT,
            defaultBackend: status.computer.defaultProvider,
            version: agent.args.config.version,
            skills: status.skills.total,
            visibleSkills: status.skills.visible,
            modelSkills: status.skills.modelEnabled,
            subAgents: status.subAgent.total,
            tools: status.tool.total,
            mainTools: status.tool.mainEnabled,
            subAgentTools: status.tool.subAgentEnabled,
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

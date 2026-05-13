/** @module utils/runtime_sync */

import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join, posix } from 'path'
import { CallbackManager } from '@langchain/core/callbacks/manager'
import {
    type AgentCallbackEvent,
    type AgentRunContext,
    CHATLUNA_AGENT_EVENT
} from 'koishi-plugin-chatluna/llm-core/agent'
import type { ChatCallbacksProvider } from 'koishi-plugin-chatluna/services/chat'
import { Context } from 'koishi'
import { logger } from '..'
import { getRemoteSkillsRoot } from '../computer/materialize'
import type { ComputerSessionApi } from '../computer/types'
import {
    DEFAULT_SKILL_DIRS,
    getSkillsRootPath,
    getSubAgentsRootPath
} from '../config/path'
import { REMOTE_SUBAGENTS_ROOT } from '../sub-agent/scan'
import type { ChatLunaAgentService } from '../service'
import { resolveTildeDir } from './path'
import { quoteShellPath } from './shell'

interface RuntimeSyncFile {
    kind: 'skill' | 'subagent'
    targetPath: string
    content: string
}

export class ChatLunaAgentRuntimeSyncService {
    private _dispose?: () => void
    private _runs = new Map<string, string>()
    private _states = new Map<string, RuntimeSyncState>()

    constructor(
        private ctx: Context,
        private getAgent: () => ChatLunaAgentService
    ) {}

    async start() {
        this._dispose?.()
        this._dispose = this.ctx.chatluna.registerCallbacksProvider(
            this.createProvider()
        )
    }

    async stop() {
        this._dispose?.()
        this._dispose = undefined
        this._runs.clear()
        this._states.clear()
    }

    private createProvider(): ChatCallbacksProvider {
        return async () => {
            return CallbackManager.fromHandlers({
                handleChainStart: async (
                    _chain,
                    _inputs,
                    runId,
                    _parentRunId,
                    _tags,
                    metadata
                ) => {
                    if (!runId) {
                        return
                    }

                    const context = (metadata?.chatlunaAgent ??
                        metadata?.['chatlunaAgent']) as
                        | AgentRunContext
                        | undefined
                    if (!context) {
                        return
                    }

                    this.registerRun(String(runId), context)
                },
                handleChainEnd: async (_output, runId) => {
                    if (!runId) {
                        return
                    }

                    await this.finishRun(String(runId))
                },
                handleChainError: async (_err, runId) => {
                    if (!runId) {
                        return
                    }

                    await this.finishRun(String(runId))
                },
                handleCustomEvent: async (name, data, runId) => {
                    if (name !== CHATLUNA_AGENT_EVENT || !runId) {
                        return
                    }

                    if (
                        isRuntimeSyncToolCall(
                            (data as AgentCallbackEvent).event
                        )
                    ) {
                        this.markDirty(String(runId))
                    }
                }
            })
        }
    }

    private registerRun(runId: string, context: AgentRunContext) {
        if (this._runs.has(runId)) {
            return
        }

        const key = getRuntimeKey(context)
        this._runs.set(runId, key)
        const current = this._states.get(key)
        if (current) {
            current.count += 1
            current.context = context
            return
        }

        this._states.set(key, {
            count: 1,
            context,
            dirty: false
        })
    }

    private markDirty(runId: string) {
        const key = this._runs.get(runId)
        if (!key) {
            return
        }

        const state = this._states.get(key)
        if (state) {
            state.dirty = true
        }
    }

    private async finishRun(runId: string) {
        const key = this._runs.get(runId)
        if (!key) {
            return
        }

        this._runs.delete(runId)
        const state = this._states.get(key)
        if (!state) {
            return
        }

        state.count -= 1
        if (state.count > 0) {
            return
        }

        if (!state.dirty) {
            this._states.delete(key)
            return
        }

        const agent = this.getAgent()

        try {
            const session = await agent.computer.getAgentSession(state.context)
            if (session && session.backend !== 'local') {
                await syncRuntimeSession(agent, session)
            }

            this._states.delete(key)
        } catch (err) {
            this.ctx.logger.warn('Failed to flush runtime sync files', err)
        }
    }
}

interface RuntimeSyncState {
    count: number
    context: AgentRunContext
    dirty: boolean
}

function isRuntimeSyncToolCall(event: AgentCallbackEvent['event']) {
    return (
        event.type === 'tool-call' &&
        event.actions.some((item) =>
            ['bash', 'file_write', 'file_edit'].includes(item.tool)
        )
    )
}

async function syncRuntimeSession(
    agent: ChatLunaAgentService,
    session: ComputerSessionApi
) {
    const skillRoots = Array.from(
        new Map(
            [
                getSkillsRootPath(agent.ctx),
                ...DEFAULT_SKILL_DIRS.map((item) =>
                    resolveTildeDir(agent.ctx.baseDir, item)
                ),
                ...agent.args.config.skills.dirs
                    .map((item) => item.trim())
                    .filter(Boolean)
                    .map((item) => resolveTildeDir(agent.ctx.baseDir, item))
            ].map((item) => [item.replaceAll('\\', '/').toLowerCase(), item])
        ).values()
    )
    const files = [
        ...(await collectSyncFiles(
            session,
            'skill',
            getRemoteSkillsRoot(),
            skillRoots
        )),
        ...(await collectSyncFiles(session, 'subagent', REMOTE_SUBAGENTS_ROOT, [
            getSubAgentsRootPath(agent.ctx)
        ]))
    ]

    for (const item of files) {
        await mkdir(dirname(item.targetPath), { recursive: true })
        await writeFile(item.targetPath, item.content, 'utf-8')
    }

    if (files.some((item) => item.kind === 'skill')) {
        await agent.skills.reload()
    }

    if (files.some((item) => item.kind === 'subagent')) {
        await agent.subAgent.reload()
    }

    if (files.length > 0) {
        await agent.refreshConsoleData()
    }
}

async function collectSyncFiles(
    session: ComputerSessionApi,
    kind: RuntimeSyncFile['kind'],
    remoteRoot: string,
    localRoots: string[]
) {
    const files: RuntimeSyncFile[] = []
    const remoteFiles = await listRemoteFiles(session, remoteRoot)
    if (remoteFiles.length > 0) {
        logger?.debug(
            `collectSyncFiles kind=${kind} backend=${session.backend} remoteRoot=${remoteRoot} files=${remoteFiles.length} localRoots=${localRoots.length}`
        )
    }

    for (const file of remoteFiles) {
        const sourcePath = posix.join(remoteRoot, file)
        const content = await session.readFile(sourcePath)

        for (const localRoot of localRoots) {
            const targetPath = join(localRoot, ...file.split('/'))
            const current = await readFile(targetPath, 'utf-8').catch(
                (err: NodeJS.ErrnoException) => {
                    if (err.code === 'ENOENT') {
                        return undefined
                    }

                    throw err
                }
            )

            if (current === content) {
                continue
            }

            files.push({
                kind,
                targetPath,
                content
            })
        }
    }

    if (files.length > 0) {
        logger?.debug(
            `collectSyncFiles kind=${kind} pending=${files.length} (${files.map((f) => f.targetPath).join(', ')})`
        )
    }

    return files
}

async function listRemoteFiles(session: ComputerSessionApi, root: string) {
    const quoted = quoteShellPath(root)
    const result = await session.execute(
        `[ -d ${quoted} ] && find ${quoted} -type f -printf '%P\n' || true`
    )

    if (result.stderr.trim()) {
        throw new Error(result.stderr.trim())
    }

    return result.stdout
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
}

function getRuntimeKey(context: AgentRunContext) {
    return [
        context.requestId ??
            context.conversationId ??
            context.parentConversationId ??
            'runtime',
        context.kind,
        context.agentId ?? 'main'
    ].join(':')
}

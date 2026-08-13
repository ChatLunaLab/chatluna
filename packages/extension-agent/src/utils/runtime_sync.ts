/** @module utils/runtime_sync */

import { Buffer } from 'node:buffer'
import { createHash } from 'crypto'
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
import { getSkillsRootPath, getSubAgentsRootPath } from '../config/path'
import { REMOTE_SUBAGENTS_ROOT } from '../sub-agent/scan'
import type { ChatLunaAgentService } from '../service'
import { quoteShellPath } from './shell'

interface RuntimeSyncFile {
    kind: 'skill' | 'subagent'
    targetPath: string
    content: Buffer
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
                        AgentRunContext | undefined
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
            logger.warn('Failed to flush runtime sync files', err)
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
    const files = [
        ...(await collectSyncFiles(
            session,
            'skill',
            getRemoteSkillsRoot(),
            getSkillsRootPath(agent.ctx)
        )),
        ...(await collectSyncFiles(
            session,
            'subagent',
            REMOTE_SUBAGENTS_ROOT,
            getSubAgentsRootPath(agent.ctx)
        ))
    ]

    for (const item of files) {
        await mkdir(dirname(item.targetPath), { recursive: true })
        await writeFile(item.targetPath, item.content)
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
    localRoot: string
) {
    const files: RuntimeSyncFile[] = []
    const remoteFiles = await listRemoteFiles(session, remoteRoot)
    const remotePaths = remoteFiles.map((file) =>
        posix.join(remoteRoot, file.replaceAll('\\', '/'))
    )
    const remoteHashes = session.hashFiles
        ? await session.hashFiles(remotePaths).catch(() => undefined)
        : undefined
    if (remoteFiles.length > 0) {
        logger?.debug(
            `collectSyncFiles kind=${kind} backend=${session.backend} remoteRoot=${remoteRoot} files=${remoteFiles.length} localRoot=${localRoot}`
        )
    }

    for (const file of remoteFiles) {
        const name = file.replaceAll('\\', '/')
        if (kind === 'subagent') {
            const lower = name.toLowerCase()
            if (
                !lower.endsWith('.md') ||
                lower === 'config.json' ||
                lower.startsWith('skills/') ||
                lower.startsWith('tmp/')
            ) {
                continue
            }
        }

        const targetPath = join(localRoot, ...name.split('/'))
        const current = await readFile(targetPath).catch(
            (err: NodeJS.ErrnoException) => {
                if (err.code === 'ENOENT') {
                    return undefined
                }

                throw err
            }
        )

        const remotePath = posix.join(remoteRoot, name)
        if (current && remoteHashes?.get(remotePath) === hash(current)) {
            continue
        }

        const content = await readRemoteFileBytes(session, remotePath)

        if (current?.equals(content)) {
            continue
        }

        files.push({
            kind,
            targetPath,
            content
        })
    }

    if (files.length > 0) {
        logger?.debug(
            `collectSyncFiles kind=${kind} pending=${files.length} (${files.map((f) => f.targetPath).join(', ')})`
        )
    }

    return files
}

async function readRemoteFileBytes(
    session: ComputerSessionApi,
    remotePath: string
) {
    const asset = await session.openAsset(remotePath)
    const chunks: Buffer[] = []
    for await (const chunk of asset.stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
}

function hash(value: Buffer) {
    return createHash('sha1').update(value).digest('hex')
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
    return [context.requestId, context.kind, context.agentId].join(':')
}

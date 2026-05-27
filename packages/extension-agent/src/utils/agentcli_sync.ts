/** @module utils/agentcli_sync */

import { readFile } from 'fs/promises'
import { join, posix } from 'path'
import { logger } from '..'
import { AGENTCLI_SKILL_NAME, getRemoteSkillDir } from '../computer/materialize'
import { getSkillsRootPath } from '../config/path'
import { writeConfig } from '../config/write'
import type { ChatLunaAgentService } from '../service'
import { AgentConfig } from '../types'

interface AgentcliCandidate {
    label: string
    read: () => Promise<string>
}

export interface AgentcliSyncResult {
    applied: boolean
    sources: string[]
    message: string
}

export async function syncAgentcliConfig(
    agent: ChatLunaAgentService
): Promise<AgentcliSyncResult> {
    const candidates = collectAgentcliCandidates(agent)
    const messages: string[] = []
    const sources: string[] = []
    let chosen: { content: string; parsed: unknown; source: string } | undefined

    for (const candidate of candidates) {
        let content: string
        try {
            content = await candidate.read()
        } catch (err) {
            if (isMissingFileError(err)) {
                continue
            }

            throw err
        }

        let parsed: unknown
        try {
            parsed = JSON.parse(content)
        } catch (err) {
            messages.push(
                `skip ${candidate.label}: invalid JSON (${(err as Error).message})`
            )
            continue
        }

        if (!isPlainObject(parsed) || Object.keys(parsed).length === 0) {
            messages.push(`skip ${candidate.label}: working copy is empty`)
            continue
        }

        if (canonicalJson(parsed) === canonicalJson(agent.args.config)) {
            messages.push(`skip ${candidate.label}: matches host`)
            continue
        }

        if (!chosen) {
            chosen = { content, parsed, source: candidate.label }
        } else if (canonicalJson(chosen.parsed) !== canonicalJson(parsed)) {
            throw new Error(
                `Conflicting agentcli working copies (${chosen.source} vs ${candidate.label}). Resolve manually before sync.`
            )
        }

        sources.push(candidate.label)
    }

    if (!chosen) {
        return {
            applied: false,
            sources: [],
            message: messages.join('\n') || 'no agentcli working copy found'
        }
    }

    const next = JSON.parse(chosen.content) as AgentConfig
    await writeConfig(agent.ctx, next)
    await agent.reload()
    messages.push(`applied from ${sources.join(', ')}`)

    return {
        applied: true,
        sources,
        message: messages.join('\n')
    }
}

function collectAgentcliCandidates(
    agent: ChatLunaAgentService
): AgentcliCandidate[] {
    const list: AgentcliCandidate[] = []

    const localPath = join(
        getSkillsRootPath(agent.ctx),
        AGENTCLI_SKILL_NAME,
        'config.json'
    )
    list.push({
        label: `local:${localPath}`,
        read: () => readFile(localPath, 'utf-8')
    })

    for (const info of agent.computer.listSessionInfos()) {
        if (info.backend === 'local') continue
        const session = agent.computer.getSession(info.id)
        if (!session) continue
        const remote = posix.join(
            getRemoteSkillDir(AGENTCLI_SKILL_NAME),
            'config.json'
        )
        list.push({
            label: `${info.backend}:${remote}`,
            read: () => session.readFile(remote)
        })
    }

    logger?.debug(
        `collectAgentcliCandidates count=${list.length} (${list.map((c) => c.label).join(', ') || 'none'})`
    )

    return list
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value != null && !Array.isArray(value)
}

function canonicalJson(value: unknown): string {
    return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeys)
    if (!isPlainObject(value)) return value
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value).sort()) {
        out[k] = sortKeys(value[k])
    }
    return out
}

function isMissingFileError(err: unknown): boolean {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true
    const msg = String(err instanceof Error ? err.message : err).toLowerCase()
    return (
        msg.includes('no such file') ||
        msg.includes('not found') ||
        msg.includes('does not exist')
    )
}

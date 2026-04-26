/** @module computer/materialize */

import { readFile, writeFile } from 'fs/promises'
import path, { posix } from 'path'
import { Context } from 'koishi'
import {
    listSkillResources,
    REMOTE_SKILLS_ROOT,
    ScannedSkill
} from '../skills/scan'
import { getConfigPath } from '../config/path'
import { quoteShellPath } from '../utils/shell'
import { ComputerSessionApi } from './types'

export const AGENTCLI_SKILL_NAME = 'agentcli'

export class SkillMaterializer {
    private _items = new Map<string, Map<string, string>>()

    clear() {
        this._items.clear()
    }

    getPath(skill: ScannedSkill, session: ComputerSessionApi) {
        if (session.backend === 'local') {
            return skill.dir
        }

        if (skill.remote) {
            return skill.dir
        }

        return getRemoteSkillDir(skill.name)
    }

    async materialize(
        skill: ScannedSkill,
        session: ComputerSessionApi,
        ctx?: Context
    ) {
        const root = this.getPath(skill, session)
        if (session.backend === 'local') {
            if (skill.name === AGENTCLI_SKILL_NAME && ctx) {
                await syncAgentcliConfigLocal(ctx, root)
            }
            return root
        }

        if (skill.remote) {
            const map =
                this._items.get(session.sessionId) ?? new Map<string, string>()
            map.set(skill.id, root)
            this._items.set(session.sessionId, map)
            return root
        }

        const current = this._items.get(session.sessionId)?.get(skill.id)
        if (current) {
            return current
        }

        await resetRemoteSkillDir(root, session)
        const files = await listSkillResources(skill.dir)

        await session.writeFile(posix.join(root, 'SKILL.md'), skill.raw)
        for (const file of files) {
            const hostPath = path.join(skill.dir, file)
            const data = await readFile(hostPath)
            await session.writeFile(
                posix.join(root, normalizeRemotePath(file)),
                data
            )
        }

        if (skill.name === AGENTCLI_SKILL_NAME && ctx) {
            await pushAgentcliConfigToSandbox(ctx, root, session)
        }

        const map =
            this._items.get(session.sessionId) ?? new Map<string, string>()
        map.set(skill.id, root)
        this._items.set(session.sessionId, map)
        return root
    }

    isMaterialized(skill: ScannedSkill, session: ComputerSessionApi) {
        return this._items.get(session.sessionId)?.has(skill.id) === true
    }

    getRemotePath(skill: ScannedSkill, session: ComputerSessionApi) {
        return this._items.get(session.sessionId)?.get(skill.id)
    }

    getByName(sessionId: string, name: string) {
        return Array.from(this._items.get(sessionId)?.entries() ?? []).find(
            ([, value]) => value.endsWith(`/${name}`)
        )?.[1]
    }
}

export function getRemoteSkillsRoot() {
    return REMOTE_SKILLS_ROOT
}

export function getRemoteSkillDir(name: string) {
    return posix.join(REMOTE_SKILLS_ROOT, name)
}

async function resetRemoteSkillDir(root: string, session: ComputerSessionApi) {
    const quoted = quoteShellPath(root)
    const result = await session.execute(
        `if [ -d ${quoted} ]; then rm -rf ${quoted}; elif [ -e ${quoted} ]; then rm -f ${quoted}; fi`,
        {
            timeout: 15000
        }
    )

    if (result.exitCode !== 0) {
        throw new Error(
            result.stderr.trim() ||
                result.stdout.trim() ||
                `Failed to reset remote skill dir: ${root}`
        )
    }
}

function normalizeRemotePath(value: string) {
    return value.replaceAll('\\', '/')
}

function getAgentcliConfigPath(root: string, sandbox: boolean) {
    return sandbox
        ? posix.join(root, 'config.json')
        : path.join(root, 'config.json')
}

async function readHostConfigBytes(ctx: Context) {
    const configPath = getConfigPath(ctx)
    try {
        return await readFile(configPath)
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return Buffer.from('{}\n', 'utf-8')
        }

        throw err
    }
}

async function syncAgentcliConfigLocal(ctx: Context, root: string) {
    const data = await readHostConfigBytes(ctx)
    await writeFile(getAgentcliConfigPath(root, false), data)
}

async function pushAgentcliConfigToSandbox(
    ctx: Context,
    root: string,
    session: ComputerSessionApi
) {
    const data = await readHostConfigBytes(ctx)
    await session.writeFile(getAgentcliConfigPath(root, true), data)
}

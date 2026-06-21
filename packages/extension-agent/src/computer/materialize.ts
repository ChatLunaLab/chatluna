/** @module computer/materialize */

import { createHash } from 'crypto'
import { access, readFile, writeFile } from 'fs/promises'
import path, { posix } from 'path'
import { Context } from 'koishi'
import {
    listSkillResources,
    REMOTE_SKILLS_ROOT,
    ScannedSkill
} from '../skills/scan'
import { getConfigPath } from '../config/path'
import { ComputerSessionApi } from './types'

export const AGENTCLI_SKILL_NAME = 'agentcli'

export class SkillMaterializer {
    private _items = new Map<string, Map<string, string>>()
    private _sandboxAgentcliPushed = new Set<string>()

    clear() {
        this._items.clear()
        this._sandboxAgentcliPushed.clear()
    }

    getPath(skill: ScannedSkill, session: ComputerSessionApi) {
        if (session.backend === 'local') return skill.dir
        if (skill.remote) return skill.dir
        return getRemoteSkillDir(skill.name)
    }

    async materialize(
        skill: ScannedSkill,
        session: ComputerSessionApi,
        ctx?: Context
    ) {
        const root = this.getPath(skill, session)
        if (session.backend === 'local') {
            if (
                skill.name === AGENTCLI_SKILL_NAME &&
                skill.source === 'chatluna' &&
                skill.scope === 'data' &&
                ctx
            ) {
                const target = path.join(root, 'config.json')
                try {
                    await access(target)
                } catch {
                    await writeFile(target, await readHostConfigBytes(ctx))
                }
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
        if (current) return current

        const entries: { path: string; content: string | Buffer }[] = [
            { path: posix.join(root, 'SKILL.md'), content: skill.raw }
        ]

        const files = await listSkillResources(skill.dir)
        for (const file of files) {
            const data = await readFile(path.join(skill.dir, file))
            entries.push({
                path: posix.join(root, file.replaceAll('\\', '/')),
                content: data.includes(0) ? data : data.toString('utf-8')
            })
        }

        const key = `${session.sessionId}:${skill.id}`
        if (skill.name === AGENTCLI_SKILL_NAME && ctx) {
            if (!this._sandboxAgentcliPushed.has(key)) {
                entries.push({
                    path: posix.join(root, 'config.json'),
                    content: (await readHostConfigBytes(ctx)).toString('utf-8')
                })
            }
        }

        const remote =
            (await session.hashFiles?.(entries.map((entry) => entry.path))) ??
            new Map<string, string>()

        for (const entry of entries) {
            if (remote.get(entry.path) === hash(entry.content)) {
                continue
            }
            await session.writeFile(entry.path, entry.content)
        }

        if (skill.name === AGENTCLI_SKILL_NAME && ctx) {
            this._sandboxAgentcliPushed.add(key)
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

async function readHostConfigBytes(ctx: Context) {
    try {
        return await readFile(getConfigPath(ctx))
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return Buffer.from('{}\n', 'utf-8')
        }
        throw err
    }
}

function hash(value: string | Buffer) {
    return createHash('sha1').update(value).digest('hex')
}

/** @module computer/materialize */

import { readFile } from 'fs/promises'
import path, { posix } from 'path'
import { listSkillResources, ScannedSkill } from '../skills/scan'
import { ComputerSessionApi } from './types'

export class SkillMaterializer {
    private _items = new Map<string, Map<string, string>>()

    getPath(skill: ScannedSkill, session: ComputerSessionApi) {
        if (session.backend === 'local') {
            return skill.dir
        }

        return getRemoteSkillDir(skill.name)
    }

    async materialize(skill: ScannedSkill, session: ComputerSessionApi) {
        const root = this.getPath(skill, session)
        if (session.backend === 'local') {
            return root
        }

        const current = this._items.get(session.sessionId)?.get(skill.id)
        if (current) {
            return current
        }

        const files = await listSkillResources(skill.dir)

        await session.writeFile(posix.join(root, 'SKILL.md'), skill.raw)
        for (const file of files) {
            const hostPath = path.join(skill.dir, file)
            const data = await readFile(hostPath, 'utf-8')
            await session.writeFile(
                posix.join(root, normalizeRemotePath(file)),
                data
            )
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

function normalizeRemotePath(value: string) {
    return value.replaceAll('\\', '/')
}

const REMOTE_SKILLS_ROOT = '~/.chatluna/skills'

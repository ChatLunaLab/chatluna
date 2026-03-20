/** @module skills/catalog */

import { AgentConfig, SkillInfo } from '../types'
import { applyShadowing } from '../utils/shadow'
import { ScannedSkill } from './scan'

export function buildSkillCatalog(
    skills: ScannedSkill[],
    configItems: AgentConfig['skills']['items']
): SkillInfo[] {
    const skillMap = new Map(skills.map((s) => [s.id, s]))
    const catalog: SkillInfo[] = []

    for (const skill of applyShadowing(skills)) {
        const visible =
            !skill.shadowedBy &&
            skill.enabled &&
            skill.available &&
            skill.state === 'ready'
        catalog.push({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            path: skill.path,
            dir: skill.dir,
            remote: skill.remote,
            source: skill.source,
            scope: skill.scope,
            state: skill.state,
            enabled: skill.enabled,
            available: skill.available,
            visible,
            modelEnabled: visible && skill.implicitInvocation,
            userInvocable: skill.userInvocable,
            implicitInvocation: skill.implicitInvocation,
            shadowedBy: skill.shadowedBy,
            emoji: skill.emoji,
            homepage: skill.homepage,
            skillKey: skill.skillKey,
            primaryEnv: skill.primaryEnv,
            compatibility: skill.compatibility,
            license: skill.license,
            metadata: skill.metadata,
            requires: skill.requires,
            install: skill.install,
            allowedTools: skill.allowedTools,
            diagnostics: [...skill.diagnostics]
        })
    }

    for (const [id, item] of Object.entries(configItems)) {
        if (skillMap.has(id)) {
            continue
        }

        if (/^[a-f0-9]{16}$/i.test(id)) {
            continue
        }

        catalog.push({
            id,
            name: id,
            description: '',
            path: '',
            dir: '',
            source: 'chatluna',
            scope: 'data',
            state: 'missing',
            enabled: item.enabled,
            available: false,
            visible: false,
            modelEnabled: false,
            userInvocable: false,
            implicitInvocation: false,
            diagnostics: ['Configured skill was not found during scan']
        })
    }

    return catalog.sort((a, b) => {
        const aPriority = skillMap.get(a.id)?.priority ?? 9999
        const bPriority = skillMap.get(b.id)?.priority ?? 9999

        if (aPriority !== bPriority) {
            return aPriority - bPriority
        }

        return a.path.localeCompare(b.path)
    })
}

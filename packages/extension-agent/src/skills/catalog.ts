/** @module skills/catalog */

import { AgentConfig, SkillInfo } from '../types'
import { createSkillItemConfig } from '../config/defaults'
import { applyShadowing } from '../utils/shadow'
import { ScannedSkill } from './scan'

export function buildSkillCatalog(
    skills: ScannedSkill[],
    configItems: AgentConfig['skills']['items']
): SkillInfo[] {
    const skillMap = new Map(skills.map((s) => [s.id, s]))
    const catalog: SkillInfo[] = []

    for (const skill of applyShadowing(skills)) {
        const cfg = createSkillItemConfig(configItems[skill.id])
        const mode = cfg.enabled ? cfg.mode : 'off'
        const visible =
            !skill.shadowedBy &&
            skill.enabled &&
            skill.available &&
            skill.state === 'ready' &&
            mode === 'description'
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
            enabled: cfg.enabled,
            mode,
            main: cfg.main,
            chatlunaEnabled: cfg.chatluna,
            characterEnabled: cfg.character,
            characterGroupEnabled: cfg.characterGroup,
            characterPrivateEnabled: cfg.characterPrivate,
            characterGroupMode: cfg.characterGroupMode,
            characterPrivateMode: cfg.characterPrivateMode,
            characterGroupIds: cfg.characterGroupIds,
            characterPrivateIds: cfg.characterPrivateIds,
            subAgents: cfg.subAgents,
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

        if (item.remote) {
            continue
        }

        const cfg = createSkillItemConfig(item)
        const mode = cfg.enabled ? cfg.mode : 'off'
        if (!cfg.enabled && cfg.mode !== 'description' && cfg.mode !== 'full') {
            continue
        }

        catalog.push({
            id,
            name: id,
            description: '',
            path: '',
            dir: '',
            remote: false,
            source: 'chatluna',
            scope: 'data',
            state: 'missing',
            enabled: cfg.enabled,
            mode,
            main: cfg.main,
            chatlunaEnabled: cfg.chatluna,
            characterEnabled: cfg.character,
            characterGroupEnabled: cfg.characterGroup,
            characterPrivateEnabled: cfg.characterPrivate,
            characterGroupMode: cfg.characterGroupMode,
            characterPrivateMode: cfg.characterPrivateMode,
            characterGroupIds: cfg.characterGroupIds,
            characterPrivateIds: cfg.characterPrivateIds,
            subAgents: cfg.subAgents,
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

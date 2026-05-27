/** @module skills/catalog */

import { AgentConfig, SkillInfo } from '../types'
import { createSkillItemConfig } from '../config/defaults'
import { applyShadowing } from '../utils/shadow'
import { ScannedSkill } from './scan'

export function buildSkillCatalog(
    skills: ScannedSkill[],
    configItems: AgentConfig['skills']['items'],
    preferRemote = false
): SkillInfo[] {
    const skillMap = new Map(skills.map((s) => [s.id, s]))
    const list = applyShadowing(skills, preferRemote)
    const localByName = new Map(
        list.filter((s) => !s.remote && !s.shadowedBy).map((s) => [s.name, s])
    )
    const catalog: SkillInfo[] = []

    for (const skill of list) {
        const cfg = createSkillItemConfig(
            configItems[skill.id] ??
                (skill.remote
                    ? configItems[localByName.get(skill.name)?.id ?? '']
                    : undefined)
        )
        const visible =
            !skill.shadowedBy &&
            skill.enabled &&
            skill.available &&
            skill.state === 'ready' &&
            cfg.enabled &&
            cfg.mode === 'description'

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
            mode: cfg.mode,
            authority: cfg.authority ?? 0,
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
        if (skillMap.has(id) || item.remote) continue

        const cfg = createSkillItemConfig(item)
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
            mode: cfg.mode,
            authority: cfg.authority ?? 0,
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
        const ap = skillMap.get(a.id)?.priority ?? 9999
        const bp = skillMap.get(b.id)?.priority ?? 9999
        return ap !== bp ? ap - bp : a.path.localeCompare(b.path)
    })
}

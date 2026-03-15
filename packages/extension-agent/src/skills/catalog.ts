import { AgentConfig, SkillInfo } from '../types'
import { ScannedSkill } from './scan'

export function buildSkillCatalog(
    skills: ScannedSkill[],
    configItems: AgentConfig['skills']['items']
): SkillInfo[] {
    const groups = new Map<string, ScannedSkill[]>()

    for (const skill of skills) {
        const list = groups.get(skill.name) ?? []
        list.push(skill)
        groups.set(skill.name, list)
    }

    const skillMap = new Map(skills.map((s) => [s.id, s]))
    const catalog: SkillInfo[] = []

    for (const list of groups.values()) {
        list.sort((a, b) => a.priority - b.priority)
        const winner = list.find(
            (skill) => skill.enabled && skill.state === 'ready'
        )

        for (const skill of list) {
            catalog.push({
                id: skill.id,
                name: skill.name,
                description: skill.description,
                path: skill.path,
                dir: skill.dir,
                source: skill.source,
                scope: skill.scope,
                state: skill.state,
                enabled: skill.enabled,
                visible: winner?.id === skill.id,
                modelEnabled:
                    winner?.id === skill.id && skill.implicitInvocation,
                userInvocable: skill.userInvocable,
                implicitInvocation: skill.implicitInvocation,
                shadowedBy:
                    winner && winner.id !== skill.id ? winner.id : undefined,
                compatibility: skill.compatibility,
                license: skill.license,
                metadata: skill.metadata,
                allowedTools: skill.allowedTools,
                diagnostics: [...skill.diagnostics]
            })
        }
    }

    for (const [id, item] of Object.entries(configItems)) {
        if (skillMap.has(id)) {
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

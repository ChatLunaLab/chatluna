import { SystemMessage } from '@langchain/core/messages'
import { SkillInfo } from '../types'
import { listSkillResources, ScannedSkill } from './scan'

export function renderAvailableSkills(
    skills: SkillInfo[],
    active: SkillInfo[]
) {
    const lines = ['<available_skills>']

    if (skills.length > 0) {
        lines.push(
            'You can load extra instructions with the skill tool when the current task matches one of the skills below.',
            'Use a skill early when it gives you a better workflow, checklist, or domain-specific procedure.',
            ''
        )

        for (const skill of skills) {
            lines.push(
                '  <skill>',
                `    <name>${escapeXml(skill.name)}</name>`,
                `    <description>${escapeXml(skill.description)}</description>`,
                '  </skill>'
            )
        }
    }

    if (active.length > 0) {
        lines.push('', '<loaded_skills>')

        for (const skill of active) {
            lines.push(`  <skill>${escapeXml(skill.name)}</skill>`)
        }

        lines.push(
            '</loaded_skills>',
            'These skills were loaded earlier in this conversation. Reuse them when they are still relevant.'
        )
    }

    if (skills.length > 0) {
        lines.push('', 'Use the exact skill name when calling the skill tool.')
    }

    lines.push('</available_skills>')

    return new SystemMessage(lines.join('\n'))
}

export async function renderSkillContent(
    skill: ScannedSkill,
    allowComputerUsePrompt: boolean,
    loaded = false
) {
    const resources = await listSkillResources(skill.dir)
    const lines = [
        `<skill_content name="${escapeXml(skill.name)}">`,
        loaded
            ? 'The following skill is now active for the current conversation.'
            : 'The following skill remains active for the current conversation.',
        `Description: ${skill.description}`,
        ...(skill.compatibility
            ? [`Compatibility: ${skill.compatibility}`]
            : []),
        ...(skill.allowedTools && skill.allowedTools.length > 0
            ? [`Allowed tools: ${skill.allowedTools.join(', ')}`]
            : []),
        ...(allowComputerUsePrompt
            ? [
                  'You may use available computer-use capabilities when the environment provides them.'
              ]
            : [
                  "By currently, no computer-use capabilities are available. Please don't try run or execute any computer-use capabilities."
              ]),
        '',
        skill.body.length > 0 ? skill.body : skill.raw,
        '',
        `Skill directory: ${skill.dir}`,
        'Resolve relative paths against the skill directory.',
        ...(resources.length > 0
            ? [
                  '<skill_resources>',
                  ...resources.map(
                      (file) => `  <file>${escapeXml(file)}</file>`
                  ),
                  '</skill_resources>'
              ]
            : []),
        '</skill_content>'
    ]

    return lines.join('\n')
}

export function escapeXml(value: string) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
}

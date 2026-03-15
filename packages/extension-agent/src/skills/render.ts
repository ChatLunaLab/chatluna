import { listSkillResources, ScannedSkill } from './scan'

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

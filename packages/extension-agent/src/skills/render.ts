/** @module skills/render */

import { SystemMessage } from '@langchain/core/messages'
import { SkillInfo } from '../types'
import { escapeXml } from '../utils/xml'
import { listSkillResources, ScannedSkill } from './scan'

export function renderAvailableSkills(
    skills: SkillInfo[],
    active: SkillInfo[],
    dir?: string,
    cwd?: string,
    location: 'local' | 'remote' = 'local'
) {
    const lines = ['<available_skills>']

    lines.push(
        ...(cwd
            ? [
                  `You may use available computer-use capabilities when the environment provides them. Working directory: ${escapeXml(cwd)}.`
              ]
            : [
                  "By currently, no computer-use capabilities are available. Please don't try run or execute any computer-use capabilities."
              ]),
        ''
    )

    if (dir) {
        lines.push(
            `Skills dir (${location}): ${escapeXml(dir)}`,
            'When a task installs or updates a skill, place it under <skills-dir>/<skill-name>/ and keep the entry file at <skill-dir>/SKILL.md.',
            ''
        )
    }

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
                ...(skill.dir
                    ? [`    <location>${escapeXml(skill.dir)}</location>`]
                    : []),
                '  </skill>'
            )
        }
    }

    if (active.length > 0) {
        lines.push('', '<loaded_skills>')

        for (const skill of active) {
            lines.push(
                '  <skill>',
                `    <name>${escapeXml(skill.name)}</name>`,
                ...(skill.dir
                    ? [`    <location>${escapeXml(skill.dir)}</location>`]
                    : []),
                '  </skill>'
            )
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
    loaded = false,
    options: {
        skillDir?: string
    } = {}
) {
    const resources = await listSkillResources(skill.dir)
    const lines = [
        `<skill_content name="${escapeXml(skill.name)}">`,
        loaded
            ? 'The following skill is now active for the current conversation.'
            : 'The following skill remains active for the current conversation.',
        `Description: ${skill.description}`,
        ...(options.skillDir ? [`Directory: ${options.skillDir}`] : []),
        ...(skill.homepage ? [`Homepage: ${skill.homepage}`] : []),
        ...(skill.requires
            ? [
                  `Requirements: ${[
                      skill.requires.bins?.length
                          ? `bins=${skill.requires.bins.join(', ')}`
                          : '',
                      skill.requires.anyBins?.length
                          ? `anyBins=${skill.requires.anyBins.join(', ')}`
                          : '',
                      skill.requires.env?.length
                          ? `env=${skill.requires.env.join(', ')}`
                          : '',
                      skill.requires.config?.length
                          ? `config=${skill.requires.config.join(', ')}`
                          : ''
                  ]
                      .filter(Boolean)
                      .join(' | ')}`
              ]
            : []),
        ...(skill.install && skill.install.length > 0
            ? [
                  `Install options: ${skill.install.map((item) => item.label ?? item.id).join('; ')}`
              ]
            : []),
        ...(skill.allowedTools && skill.allowedTools.length > 0
            ? [`Allowed tools: ${skill.allowedTools.join(', ')}`]
            : []),
        '',
        skill.body.length > 0 ? skill.body : skill.raw,
        '',
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

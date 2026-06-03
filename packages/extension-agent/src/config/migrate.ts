/** @module config/migrate */

import { Context } from 'koishi'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { basename, join, relative, resolve } from 'path'
import { collectFilesRecursive } from '../utils/fs'
import { createHashId } from '../utils/id'
import { getConfigPath, getSkillsRootPath, getSubAgentsRootPath } from './path'

const OLD_SKILL_DIRS = [
    './.agents/skills',
    './.openclaw/skills',
    './.codex/skills',
    './.claude/skills',
    './.opencode/skills',
    '~/.agents/skills',
    '~/.openclaw/skills',
    '~/.codex/skills',
    '~/.claude/skills',
    '~/.config/opencode/skills'
]

const OLD_SUB_AGENT_DIRS = ['~/.claude/agents', '~/.config/opencode/agents']

export async function migrateAgentData(ctx: Context) {
    const data = resolve(ctx.baseDir, 'data/chatluna')
    const old = join(data, 'agent')
    const config = getConfigPath(ctx)
    const skills = getSkillsRootPath(ctx)
    const agents = getSubAgentsRootPath(ctx)
    const oldConfig = join(old, 'config.json')
    const oldSkills = join(old, 'skills')
    const oldAgents = join(old, 'agents')
    const hasConfig = (await stat(oldConfig).catch(() => undefined))?.isFile()
    const hasSkills = (
        await stat(oldSkills).catch(() => undefined)
    )?.isDirectory()
    const hasAgents = (
        await stat(oldAgents).catch(() => undefined)
    )?.isDirectory()

    if (!hasConfig && !hasSkills && !hasAgents) {
        return
    }

    try {
        await mkdir(agents, { recursive: true })

        if (hasConfig && !(await stat(config).catch(() => undefined))) {
            const raw = await readFile(oldConfig, 'utf-8')
            let content = raw

            try {
                const cfg = JSON.parse(raw) as {
                    skills?: {
                        dirs?: string[]
                        items?: Record<string, unknown>
                    }
                    subAgent?: {
                        dirs?: string[]
                        items?: Record<string, unknown>
                    }
                }

                if (
                    cfg.skills?.dirs?.length === OLD_SKILL_DIRS.length &&
                    cfg.skills.dirs.every(
                        (item, idx) => item === OLD_SKILL_DIRS[idx]
                    )
                ) {
                    cfg.skills.dirs = []
                }

                if (
                    cfg.subAgent?.dirs?.length === OLD_SUB_AGENT_DIRS.length &&
                    cfg.subAgent.dirs.every(
                        (item, idx) => item === OLD_SUB_AGENT_DIRS[idx]
                    )
                ) {
                    cfg.subAgent.dirs = []
                }

                if (cfg.skills?.items && hasSkills) {
                    const files = (
                        await collectFilesRecursive(oldSkills)
                    ).filter((file) => basename(file) === 'SKILL.md')
                    for (const file of files) {
                        const from = createHashId(file)
                        const to = createHashId(
                            join(skills, relative(oldSkills, file))
                        )
                        if (
                            cfg.skills.items[from] != null &&
                            cfg.skills.items[to] == null
                        ) {
                            cfg.skills.items[to] = cfg.skills.items[from]
                        }
                        delete cfg.skills.items[from]
                    }
                }

                if (cfg.subAgent?.items && hasAgents) {
                    const files = await collectFilesRecursive(oldAgents, {
                        extensionFilter: '.md'
                    })
                    for (const file of files) {
                        const from = createHashId(file)
                        const to = createHashId(
                            join(agents, relative(oldAgents, file))
                        )
                        if (
                            cfg.subAgent.items[from] != null &&
                            cfg.subAgent.items[to] == null
                        ) {
                            cfg.subAgent.items[to] = cfg.subAgent.items[from]
                        }
                        delete cfg.subAgent.items[from]
                    }
                }

                content = `${JSON.stringify(cfg, null, 4)}\n`
            } catch {}

            await writeFile(config, content, 'utf-8')
        }

        if (hasSkills) {
            await mkdir(skills, { recursive: true })
            await cp(oldSkills, skills, {
                recursive: true,
                force: false,
                errorOnExist: false
            })
        }

        if (hasAgents) {
            await cp(oldAgents, agents, {
                recursive: true,
                force: false,
                errorOnExist: false
            })
        }

        await rm(old, { recursive: true, force: true })
    } catch (err) {
        ctx.logger.warn('Failed to migrate chatluna agent data', err)
    }
}

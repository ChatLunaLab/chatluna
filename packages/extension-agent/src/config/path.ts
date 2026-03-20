/** @module config/path */

import { Context } from 'koishi'
import { resolve } from 'path'

export const DEFAULT_SKILL_DIRS = [
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

export function getConfigPath(ctx: Context): string {
    return resolve(ctx.baseDir, 'data/chatluna/agent/config.json')
}

export function getSkillsRootPath(ctx: Context): string {
    return resolve(ctx.baseDir, 'data/chatluna/skills')
}

export function getSubAgentsRootPath(ctx: Context): string {
    return resolve(ctx.baseDir, 'data/chatluna/agents')
}

export function getComputerRootPath(ctx: Context): string {
    return resolve(ctx.baseDir, 'data/chatluna/computer')
}

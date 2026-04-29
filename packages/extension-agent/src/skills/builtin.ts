/** @module skills/builtin */

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { Context } from 'koishi'
import { AGENTCLI_SKILL_NAME } from '../computer/materialize'
import { getSkillsRootPath } from '../config/path'

export async function syncBundledSkills(ctx: Context) {
    const src = join(__dirname, '../resources/skills')
    const dest = getSkillsRootPath(ctx)
    const root = await stat(src).catch(() => undefined)

    if (!root?.isDirectory()) {
        ctx.logger.warn('Bundled skills directory not found')
        return
    }

    await mkdir(dest, { recursive: true })

    const entries = await readdir(src, { withFileTypes: true }).catch(() => [])

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue
        }

        const from = join(src, entry.name)
        const file = join(from, 'SKILL.md')
        const skill = await stat(file).catch(() => undefined)

        if (!skill?.isFile()) {
            continue
        }

        const to = join(dest, entry.name)
        const force = entry.name === AGENTCLI_SKILL_NAME
        const current = await stat(join(to, 'SKILL.md')).catch(() => undefined)

        if (current?.isFile() && !force) {
            continue
        }

        let preservedConfig: Buffer | undefined
        let backupPath: string | undefined
        if (force && current?.isFile()) {
            const configPath = join(to, 'config.json')
            preservedConfig = await readFile(configPath).catch(() => undefined)
            if (preservedConfig) {
                backupPath = join(dest, `${entry.name}.config.json.bak`)
                await writeFile(backupPath, preservedConfig).catch(() => {})
            }
        }

        await rm(to, { recursive: true, force: true })
        await cp(from, to, { recursive: true })

        if (preservedConfig) {
            await writeFile(join(to, 'config.json'), preservedConfig)
            if (backupPath) {
                await rm(backupPath, { force: true })
            }
        }

        ctx.logger.info(
            `${force && current?.isFile() ? 'Refreshed' : 'Copied'} bundled skill '${entry.name}' to ${to}${preservedConfig ? ' (preserved config.json)' : ''}`
        )
    }
}

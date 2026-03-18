/** @module skills/builtin */

import { cp, mkdir, readdir, rm, stat } from 'fs/promises'
import { join } from 'path'
import { Context } from 'koishi'
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
        const current = await stat(join(to, 'SKILL.md')).catch(() => undefined)

        if (current?.isFile()) {
            continue
        }

        await rm(to, { recursive: true, force: true })
        await cp(from, to, { recursive: true })
        ctx.logger.info(`Copied bundled skill '${entry.name}' to ${to}`)
    }
}

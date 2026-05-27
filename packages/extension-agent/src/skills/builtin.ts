/** @module skills/builtin */

import { copyFile, mkdir, readdir, readFile, rm, stat } from 'fs/promises'
import { dirname, join, relative } from 'path'
import { Context } from 'koishi'
import { AGENTCLI_SKILL_NAME } from '../computer/materialize'
import { getSkillsRootPath } from '../config/path'

export async function syncBundledSkills(ctx: Context) {
    const src = join(__dirname, '../resources/skills')
    const dest = getSkillsRootPath(ctx)

    if (!(await stat(src).catch(() => undefined))?.isDirectory()) {
        ctx.logger.warn('Bundled skills directory not found')
        return
    }

    await mkdir(dest, { recursive: true })

    const entries = await readdir(src, { withFileTypes: true }).catch(() => [])

    for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const from = join(src, entry.name)

        if (
            !(
                await stat(join(from, 'SKILL.md')).catch(() => undefined)
            )?.isFile()
        )
            continue

        const to = join(dest, entry.name)
        const force = entry.name === AGENTCLI_SKILL_NAME
        const exists = (
            await stat(join(to, 'SKILL.md')).catch(() => undefined)
        )?.isFile()

        if (exists && !force) continue

        if (!(await syncSkillDir(from, to, force && exists)) && force && exists)
            continue

        ctx.logger[force && exists ? 'debug' : 'info'](
            `${force && exists ? 'Refreshed' : 'Copied'} bundled skill '${entry.name}' to ${to}`
        )
    }
}

async function syncSkillDir(from: string, to: string, preserveConfig: boolean) {
    const files = await collectFiles(from)
    const current = await collectFiles(to).catch(() => [])
    const src = new Set(files)
    let changed = false

    for (const file of files) {
        if (preserveConfig && file === 'config.json') continue

        const dest = join(to, file)
        const data = await readFile(join(from, file))
        if ((await readFile(dest).catch(() => undefined))?.equals(data))
            continue

        await mkdir(dirname(dest), { recursive: true })
        await copyFile(join(from, file), dest)
        changed = true
    }

    for (const file of current) {
        if (src.has(file)) continue
        if (preserveConfig && file === 'config.json') continue

        await rm(join(to, file), { force: true })
        changed = true
    }

    return changed
}

async function collectFiles(dir: string) {
    const files: string[] = []
    const dirs = [dir]

    while (dirs.length) {
        const current = dirs.shift()!
        const entries = await readdir(current, { withFileTypes: true })

        for (const entry of entries) {
            const path = join(current, entry.name)
            if (entry.isDirectory()) {
                dirs.push(path)
                continue
            }

            if (entry.isFile()) files.push(relative(dir, path))
        }
    }

    return files.sort((a, b) => a.localeCompare(b))
}

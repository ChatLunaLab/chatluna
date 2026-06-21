import type { FSWatcher } from 'fs'
import { watch } from 'fs'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import { Context } from 'koishi'
import { logger } from '..'
import { AgentConfig } from '../types'
import { toPathKey } from '../utils/path'
import { getSkillRoots } from './scan'

export async function watchSkillFiles(
    ctx: Context,
    cfg: AgentConfig['skills'],
    reload: () => Promise<void>
) {
    const roots = await getSkillRoots(ctx, cfg)
    const recursive =
        process.platform === 'win32' || process.platform === 'darwin'

    const dirs: string[] = []
    if (recursive) {
        for (const r of roots) {
            if ((await stat(r).catch(() => undefined))?.isDirectory()) {
                dirs.push(r)
            }
        }
    } else {
        dirs.push(...(await getAllDirs(roots)))
    }

    const watchers: FSWatcher[] = []
    let timer: NodeJS.Timeout | undefined
    let closed = false
    let reloading = false
    let pending = false

    const schedule = () => {
        if (closed) return
        if (reloading) {
            pending = true
            return
        }
        clearTimeout(timer)
        timer = setTimeout(async () => {
            timer = undefined
            reloading = true
            try {
                await reload()
            } catch (err) {
                logger.error('Failed to hot reload skills', err)
            } finally {
                reloading = false
                if (pending) {
                    pending = false
                    schedule()
                }
            }
        }, 100)
    }

    for (const dir of dirs) {
        try {
            const watcher = recursive
                ? watch(dir, { recursive: true }, schedule)
                : watch(dir, schedule)

            watcher.on('error', (err) => {
                logger.warn(`Skill watcher error at ${dir}: ${String(err)}`)
                schedule()
            })

            watchers.push(watcher)
        } catch (err) {
            logger.warn(`Failed to watch skill dir ${dir}: ${String(err)}`)
        }
    }

    return () => {
        closed = true
        clearTimeout(timer)
        for (const watcher of watchers) watcher.close()
    }
}

async function getAllDirs(roots: string[]) {
    const seen = new Set<string>()
    const queue: string[] = []
    const dirs: string[] = []

    for (const r of roots) {
        if ((await stat(r).catch(() => undefined))?.isDirectory()) {
            queue.push(r)
        }
    }

    while (queue.length) {
        const dir = queue.shift()!
        const key = toPathKey(dir)
        if (seen.has(key)) continue

        seen.add(key)
        dirs.push(dir)

        const entries = await readdir(dir, { withFileTypes: true }).catch(
            () => []
        )
        for (const entry of entries) {
            if (entry.isDirectory()) queue.push(join(dir, entry.name))
        }
    }

    return dirs
}

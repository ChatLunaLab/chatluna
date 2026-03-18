/** @module skills/watch */

import type { FSWatcher } from 'fs'
import { watch } from 'fs'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import { Context } from 'koishi'
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
    const dirs = recursive
        ? await getExistingRoots(roots)
        : await getWatchDirs(roots)

    const watchers: FSWatcher[] = []
    let timer: NodeJS.Timeout | undefined
    let closed = false
    let queued = false
    let running = false

    const run = async () => {
        if (closed) {
            return
        }

        if (running) {
            queued = true
            return
        }

        running = true

        try {
            do {
                queued = false
                await reload()
            } while (queued && !closed)
        } catch (err) {
            ctx.logger.error('Failed to hot reload skills', err)
        } finally {
            running = false
        }
    }

    const schedule = () => {
        if (closed) {
            return
        }

        if (timer) {
            clearTimeout(timer)
        }

        timer = setTimeout(() => {
            timer = undefined
            void run()
        }, 100)
    }

    for (const dir of dirs) {
        try {
            const watcher = recursive
                ? watch(dir, { recursive: true }, schedule)
                : watch(dir, schedule)

            watcher.on('error', (err) => {
                ctx.logger.warn(`Skill watcher error at ${dir}: ${String(err)}`)
                schedule()
            })

            watchers.push(watcher)
        } catch (err) {
            ctx.logger.warn(`Failed to watch skill dir ${dir}: ${String(err)}`)
        }
    }

    return () => {
        closed = true

        if (timer) {
            clearTimeout(timer)
            timer = undefined
        }

        for (const watcher of watchers) {
            watcher.close()
        }
    }
}

async function getExistingRoots(roots: string[]) {
    const dirs: string[] = []

    for (const dir of roots) {
        const info = await stat(dir).catch(() => undefined)
        if (info?.isDirectory()) {
            dirs.push(dir)
        }
    }

    return dirs
}

async function getWatchDirs(roots: string[]) {
    const seen = new Set<string>()
    const queue: string[] = []
    const dirs: string[] = []

    for (const dir of roots) {
        const info = await stat(dir).catch(() => undefined)
        if (info?.isDirectory()) {
            queue.push(dir)
        }
    }

    while (queue.length > 0) {
        const dir = queue.shift()
        if (!dir) {
            continue
        }

        const key = toPathKey(dir)
        if (seen.has(key)) {
            continue
        }

        seen.add(key)
        dirs.push(dir)

        const entries = await readdir(dir, { withFileTypes: true }).catch(
            () => []
        )
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue
            }

            queue.push(join(dir, entry.name))
        }
    }

    return dirs
}

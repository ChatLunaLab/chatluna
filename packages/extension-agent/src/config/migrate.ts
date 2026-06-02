/** @module config/migrate */

import { Context } from 'koishi'
import { cp, mkdir, rm, stat } from 'fs/promises'
import { join, resolve } from 'path'

export async function migrateAgentData(ctx: Context) {
    const data = resolve(ctx.baseDir, 'data/chatluna')
    const root = join(data, 'agents')
    const old = join(data, 'agent')

    try {
        await mkdir(root, { recursive: true })

        if (
            (
                await stat(join(old, 'config.json')).catch(() => undefined)
            )?.isFile()
        ) {
            await cp(join(old, 'config.json'), join(root, 'config.json'), {
                force: false,
                errorOnExist: false
            })
        }

        if (
            (
                await stat(join(old, 'skills')).catch(() => undefined)
            )?.isDirectory()
        ) {
            await cp(join(old, 'skills'), join(root, 'skills'), {
                recursive: true,
                force: false,
                errorOnExist: false
            })
        }

        if (
            (
                await stat(join(old, 'agents')).catch(() => undefined)
            )?.isDirectory()
        ) {
            await cp(join(old, 'agents'), root, {
                recursive: true,
                force: false,
                errorOnExist: false
            })
        }

        if (
            (
                await stat(join(data, 'skills')).catch(() => undefined)
            )?.isDirectory()
        ) {
            await cp(join(data, 'skills'), join(root, 'skills'), {
                recursive: true,
                force: false,
                errorOnExist: false
            })
            await rm(join(data, 'skills'), { recursive: true, force: true })
        }

        await rm(old, { recursive: true, force: true })
    } catch (err) {
        ctx.logger.warn('Failed to migrate chatluna agent data', err)
    }
}

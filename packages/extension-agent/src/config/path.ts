import { Context } from 'koishi'
import { resolve } from 'path'

export function getConfigPath(ctx: Context): string {
    return resolve(ctx.baseDir, 'data/chatluna/agent/config.json')
}

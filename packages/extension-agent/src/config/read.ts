/** @module config/read */

import { Context } from 'koishi'
import { readFile } from 'fs/promises'
import { getConfigPath } from './path'
import { getDefaultConfig } from './defaults'
import { AgentConfig } from '../types'

export async function readConfig(ctx: Context): Promise<AgentConfig> {
    const path = getConfigPath(ctx)
    try {
        const content = await readFile(path, 'utf-8')
        return JSON.parse(content)
    } catch {
        return getDefaultConfig()
    }
}

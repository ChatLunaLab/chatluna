/** @module config/write */

import { Context } from 'koishi'
import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { getConfigPath } from './path'
import { AgentConfig } from '../types'

export async function writeConfig(ctx: Context, cfg: AgentConfig) {
    const path = getConfigPath(ctx)
    const saved = { ...cfg } as Omit<AgentConfig, 'trigger'> & {
        trigger?: unknown
    }
    delete saved.trigger
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(saved, null, 2) + '\n', 'utf-8')
}

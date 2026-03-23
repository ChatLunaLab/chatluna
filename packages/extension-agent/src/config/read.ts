/** @module config/read */

import { Context } from 'koishi'
import { readFile } from 'fs/promises'
import { getConfigPath } from './path'
import { createToolItemConfig, getDefaultConfig } from './defaults'
import { AgentConfig } from '../types'

export async function readConfig(ctx: Context): Promise<AgentConfig> {
    const path = getConfigPath(ctx)
    try {
        const content = await readFile(path, 'utf-8')
        const base = getDefaultConfig()
        const cfg = JSON.parse(content) as AgentConfig
        return {
            ...base,
            ...cfg,
            tool: {
                ...base.tool,
                registry: {
                    ...(base.tool.registry ?? {}),
                    ...(cfg.tool?.registry ?? {})
                },
                items: Object.fromEntries(
                    Object.entries(cfg.tool?.items ?? {}).map(
                        ([name, item]) => [
                            name,
                            createToolItemConfig(item, name)
                        ]
                    )
                )
            }
        }
    } catch {
        return getDefaultConfig()
    }
}

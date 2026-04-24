/** @module config/read */

import { Context } from 'koishi'
import { readFile } from 'fs/promises'
import {
    AgentConfig,
    createToolDefaultAvailability,
    createToolMetaOverride
} from '../types'
import { getConfigPath } from './path'
import {
    createSkillItemConfig,
    createToolItemConfig,
    getDefaultConfig
} from './defaults'

export async function readConfig(ctx: Context): Promise<AgentConfig> {
    const path = getConfigPath(ctx)
    try {
        const content = await readFile(path, 'utf-8')
        const base = getDefaultConfig()
        const cfg = JSON.parse(content) as AgentConfig
        return {
            ...base,
            ...cfg,
            skills: {
                ...base.skills,
                ...(cfg.skills ?? {}),
                items: Object.fromEntries(
                    Object.entries({
                        ...(base.skills.items ?? {}),
                        ...(cfg.skills?.items ?? {})
                    }).map(([id, item]) => [id, createSkillItemConfig(item)])
                ),
                dirs: [...(cfg.skills?.dirs ?? base.skills.dirs)]
            },
            tool: {
                ...base.tool,
                registry: Object.fromEntries(
                    Object.keys({
                        ...(base.tool.registry ?? {}),
                        ...(cfg.tool?.registry ?? {})
                    }).map((name) => {
                        const baseItem = base.tool.registry?.[name]
                        const saved = cfg.tool?.registry?.[name]
                        return [
                            name,
                            createToolMetaOverride({
                                ...(baseItem ?? {}),
                                ...(saved ?? {}),
                                defaultAvailability: {
                                    ...(createToolDefaultAvailability(
                                        baseItem
                                    ) ?? {}),
                                    ...(createToolDefaultAvailability(saved) ??
                                        {})
                                }
                            })
                        ]
                    })
                ),
                items: Object.fromEntries(
                    Object.entries(cfg.tool?.items ?? {}).map(
                        ([name, item]) => [
                            name,
                            createToolItemConfig(item, name)
                        ]
                    )
                )
            },
            trigger: {
                ...base.trigger,
                ...(cfg.trigger ?? {}),
                providers: {
                    ...(base.trigger?.providers ?? {}),
                    ...(cfg.trigger?.providers ?? {})
                }
            }
        }
    } catch {
        return getDefaultConfig()
    }
}

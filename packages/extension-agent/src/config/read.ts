/** @module config/read */

import { Context } from 'koishi'
import { readFile } from 'fs/promises'
import { deepAssign } from 'koishi-plugin-chatluna/utils/object'
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

function mergeSkills(base: AgentConfig['skills'], cfg: AgentConfig['skills']) {
    return {
        ...base,
        ...cfg,
        items: Object.fromEntries(
            Object.entries({
                ...(base.items ?? {}),
                ...(cfg?.items ?? {})
            }).map(([id, item]) => [id, createSkillItemConfig(item)])
        ),
        dirs: [...(cfg?.dirs ?? base.dirs)]
    }
}

function mergeToolRegistry(
    base: AgentConfig['tool']['registry'],
    saved: AgentConfig['tool']['registry']
) {
    const keys = Object.keys({ ...(base ?? {}), ...(saved ?? {}) })
    return Object.fromEntries(
        keys.map((name) => {
            const b = base?.[name]
            const s = saved?.[name]
            return [
                name,
                createToolMetaOverride({
                    ...(b ?? {}),
                    ...(s ?? {}),
                    defaultAvailability: {
                        ...(createToolDefaultAvailability(b) ?? {}),
                        ...(createToolDefaultAvailability(s) ?? {})
                    }
                })
            ]
        })
    )
}

function mergeTool(
    base: AgentConfig['tool'],
    cfg?: Partial<AgentConfig['tool']>
) {
    return {
        ...base,
        registry: mergeToolRegistry(base.registry, cfg?.registry),
        items: Object.fromEntries(
            Object.entries({
                ...(base.items ?? {}),
                ...(cfg?.items ?? {})
            }).map(([name, item]) => [name, createToolItemConfig(item, name)])
        )
    }
}

export async function readConfig(ctx: Context): Promise<AgentConfig> {
    const path = getConfigPath(ctx)
    try {
        const content = await readFile(path, 'utf-8')
        const base = getDefaultConfig()
        const cfg = JSON.parse(content) as Omit<AgentConfig, 'trigger'> & {
            trigger?: unknown
        }
        delete cfg.trigger
        return {
            ...base,
            ...cfg,
            skills: mergeSkills(base.skills, cfg.skills),
            tool: mergeTool(base.tool, cfg.tool),
            computer: deepAssign({}, base.computer, cfg.computer ?? {}),
            subAgent: deepAssign({}, base.subAgent, cfg.subAgent ?? {})
        }
    } catch {
        return getDefaultConfig()
    }
}

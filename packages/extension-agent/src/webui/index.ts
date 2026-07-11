/** @module webui/index */

import { DataService } from '@koishijs/plugin-console'
import { Context } from 'koishi'
import { listModelNames } from 'koishi-plugin-chatluna/utils/schema'
import { resolve } from 'path'
import { logger } from '..'
import { getSkillsRootPath } from '../config/path'
import { readConfig } from '../config/read'
import type { ChatLunaAgentService } from '../service'
import type { SkillMode, TriggerActor } from '../types'
import { AgentConsoleData, AgentStatus, McpServerConfig } from '../types'

class ChatLunaAgentConsoleService extends DataService<AgentConsoleData> {
    constructor(ctx: Context) {
        super(ctx, 'chatluna_agent_webui', {
            immediate: true
        })
    }

    async get(forced?: boolean) {
        if (this.ctx.chatluna_agent) {
            return JSON.parse(
                JSON.stringify(this.ctx.chatluna_agent.getConsoleData())
            )
        }

        return {
            config: await readConfig(this.ctx),
            status: createEmptyStatus(this.ctx)
        } satisfies AgentConsoleData
    }
}

type AgentRef = () => ChatLunaAgentService

function createEmptyStatus(ctx: Context): AgentStatus {
    return {
        mcp: { connected: false, servers: {}, tools: {} },
        skills: {
            enabled: true,
            root: getSkillsRootPath(ctx),
            total: 0,
            visible: 0,
            modelEnabled: 0,
            activeConversations: 0,
            catalog: {}
        },
        computer: {
            enabled: false,
            defaultProvider: 'e2b',
            backends: {
                local: {
                    type: 'local',
                    state: 'unsupported',
                    capabilities: [
                        'file_read',
                        'file_write',
                        'file_edit',
                        'grep',
                        'glob',
                        'bash',
                        'terminal_pty'
                    ],
                    sessionCount: 0
                },
                e2b: {
                    type: 'e2b',
                    state: 'unsupported',
                    capabilities: [
                        'file_read',
                        'file_write',
                        'file_edit',
                        'grep',
                        'glob',
                        'bash',
                        'terminal_pty',
                        'desktop_stream',
                        'desktop_screenshot',
                        'desktop_action'
                    ],
                    sessionCount: 0
                },
                'open-terminal': {
                    type: 'open-terminal',
                    state: 'unsupported',
                    capabilities: [
                        'file_read',
                        'file_write',
                        'file_edit',
                        'grep',
                        'glob',
                        'bash',
                        'terminal_pty'
                    ],
                    sessionCount: 0
                }
            },
            activeSessions: 0
        },
        subAgent: {
            enabled: false,
            total: 0,
            catalog: {},
            runs: []
        },
        tool: {
            enabled: false,
            total: 0,
            mainEnabled: 0,
            subAgentEnabled: 0,
            catalog: {}
        },
        trigger: {
            total: 0,
            enabled: 0,
            waiting: 0,
            running: 0,
            paused: 0,
            error: 0
        }
    }
}

function ok<T, A extends unknown[]>(fn: (...args: A) => Promise<T>) {
    return async (...args: A) => {
        await fn(...args)
        return { success: true }
    }
}

function registerBaseListeners(ctx: Context, agent: AgentRef) {
    ctx.console.addListener(
        'chatluna-agent/getConfig',
        async () => agent().getConsoleData().config
    )

    ctx.console.addListener(
        'chatluna-agent/saveConfig',
        ok((cfg) => agent().saveConfig(cfg))
    )

    ctx.console.addListener('chatluna-agent/getStatus', async () =>
        agent().getStatus()
    )

    ctx.console.addListener(
        'chatluna-agent/getModelNames',
        async () => listModelNames(ctx.chatluna.platform).value
    )

    ctx.console.addListener(
        'chatluna-agent/refreshConsoleData',
        ok(() => agent().refreshConsoleData())
    )
}

function registerComputerListeners(ctx: Context, agent: AgentRef) {
    ctx.console.addListener('chatluna-agent/getComputerStatus', async () =>
        agent().computer.getStatus()
    )

    ctx.console.addListener(
        'chatluna-agent/openComputerTerminal',
        async function (input) {
            return await agent().computer.createTerminal(this.id, input)
        }
    )

    ctx.console.addListener(
        'chatluna-agent/closeComputerTerminal',
        ok(async (sessionId, terminalId) => {
            await agent().computer.closeTerminal(sessionId, terminalId)
        })
    )

    ctx.console.addListener(
        'chatluna-agent/listComputerBackgroundJobs',
        async (input) =>
            await agent().computer.listBackgroundJobs(input?.backend)
    )

    ctx.console.addListener(
        'chatluna-agent/killComputerBackgroundJob',
        ok(async (jobId) => {
            await agent().computer.killBackgroundJob(jobId)
        })
    )

    ctx.console.addListener(
        'chatluna-agent/removeComputerBackgroundJob',
        ok(async (jobId) => {
            await agent().computer.removeBackgroundJob(jobId)
        })
    )

    ctx.console.addListener(
        'chatluna-agent/readComputerFile',
        async function (input) {
            return await agent().computer.readFileForUi(this.id, input)
        }
    )

    ctx.console.addListener(
        'chatluna-agent/readComputerFileAsset',
        async function (input) {
            return await agent().computer.readFileAssetForUi(this.id, input)
        }
    )

    ctx.console.addListener(
        'chatluna-agent/globComputerFiles',
        async function (input) {
            return await agent().computer.globForUi(this.id, input)
        }
    )

    ctx.console.addListener(
        'chatluna-agent/getComputerHome',
        async function (input) {
            return await agent().computer.getHomeForUi(this.id, input?.backend)
        }
    )

    ctx.console.addListener(
        'chatluna-agent/getComputerDesktop',
        async function (input) {
            return await agent().computer.getDesktopState(
                this.id,
                input?.backend
            )
        }
    )

    ctx.console.addListener(
        'chatluna-agent/sendComputerDesktopAction',
        ok(async (sessionId, action) => {
            await agent().computer.sendDesktopAction(sessionId, action)
        })
    )

    ctx.console.addListener('chatluna-agent/testBackend', async (type) =>
        agent().computer.testBackend(type)
    )

    ctx.console.addListener(
        'chatluna-agent/saveComputer',
        ok((cfg) => agent().saveComputerConfig(cfg))
    )

    ctx.console.addListener(
        'chatluna-agent/reloadComputer',
        ok(async () => {
            await agent().computer.reload()
            await agent().skills.reload()
            await agent().refreshConsoleData()
        })
    )
}

function registerSkillsListeners(ctx: Context, agent: AgentRef) {
    ctx.console.addListener('chatluna-agent/getSkills', async () =>
        agent().skills.listSkills()
    )

    ctx.console.addListener('chatluna-agent/getSkillContent', async (id) =>
        agent().skills.getSkillContent(id)
    )

    ctx.console.addListener(
        'chatluna-agent/saveSkillContent',
        async (id, content) => ({
            success:
                (await agent().skills.saveSkillContent(id, content)) !== false
        })
    )

    ctx.console.addListener('chatluna-agent/exportSkill', async (id) =>
        agent().exportSkill(id)
    )

    ctx.console.addListener(
        'chatluna-agent/previewSkillImport',
        async (input) => agent().previewSkillImport(input)
    )

    ctx.console.addListener('chatluna-agent/importSkills', async (input) => {
        return await agent().importSkills(input)
    })

    ctx.console.addListener(
        'chatluna-agent/saveSkills',
        ok((cfg) => agent().saveSkillsConfig(cfg))
    )

    ctx.console.addListener(
        'chatluna-agent/reloadSkills',
        ok(async () => {
            await agent().skills.reload()
            await agent().refreshConsoleData()
        })
    )

    ctx.console.addListener(
        'chatluna-agent/removeSkill',
        ok((id: string) => agent().removeSkill(id))
    )

    ctx.console.addListener(
        'chatluna-agent/setSkillEnabled',
        ok((id: string, enabled: boolean) =>
            agent().setSkillEnabled(id, enabled)
        )
    )

    ctx.console.addListener(
        'chatluna-agent/setSkillMode',
        ok((id: string, mode: SkillMode) => agent().setSkillMode(id, mode))
    )
}

function registerSubAgentListeners(ctx: Context, agent: AgentRef) {
    ctx.console.addListener('chatluna-agent/getSubAgents', async () =>
        agent().subAgent.getCatalogSync()
    )

    ctx.console.addListener('chatluna-agent/getSubAgentRuns', async () =>
        agent().subAgent.getRuns()
    )

    ctx.console.addListener('chatluna-agent/stopSubAgentTask', async (id) =>
        agent().stopSubAgentTask(id)
    )

    ctx.console.addListener(
        'chatluna-agent/saveSubAgentConfig',
        ok((cfg) => agent().saveSubAgentConfig(cfg))
    )

    ctx.console.addListener(
        'chatluna-agent/reloadSubAgents',
        ok(async () => {
            await agent().reloadSubAgents()
        })
    )

    ctx.console.addListener(
        'chatluna-agent/setSubAgentEnabled',
        ok((id: string, enabled: boolean) =>
            agent().setSubAgentEnabled(id, enabled)
        )
    )

    ctx.console.addListener(
        'chatluna-agent/addSubAgent',
        async (input) => await agent().addSubAgent(input)
    )

    ctx.console.addListener(
        'chatluna-agent/saveSubAgentContent',
        async (id, input) => await agent().saveSubAgentContent(id, input)
    )

    ctx.console.addListener('chatluna-agent/exportSubAgent', async (id) =>
        agent().exportSubAgent(id)
    )

    ctx.console.addListener(
        'chatluna-agent/uploadSubAgent',
        ok((input) => agent().uploadSubAgent(input))
    )

    ctx.console.addListener(
        'chatluna-agent/previewSubAgentImport',
        async (data) => agent().previewSubAgentImport(data)
    )

    ctx.console.addListener(
        'chatluna-agent/createPresetAgent',
        ok((name: string, preset: string, config) =>
            agent().createPresetAgent(name, preset, config)
        )
    )

    ctx.console.addListener(
        'chatluna-agent/removeSubAgent',
        ok((id: string) => agent().removeSubAgent(id))
    )

    ctx.console.addListener('chatluna-agent/getPresetNames', async () =>
        agent().getPresetNames()
    )
}

function registerToolListeners(ctx: Context, agent: AgentRef) {
    ctx.console.addListener('chatluna-agent/getToolAvailability', async () =>
        agent().getToolAvailability()
    )
}

function registerTriggerListeners(ctx: Context, agent: AgentRef) {
    const auth = { authority: 3 }
    const withBot = async <T>(
        platform: string,
        selfId: string,
        fn: (bot: NonNullable<Context['bots'][string]>) => Promise<T>,
        fallback: T
    ): Promise<T> => {
        const bot = ctx.bots[`${platform}:${selfId}`] ?? ctx.bots[selfId]
        if (bot == null) return fallback
        try {
            return await fn(bot)
        } catch (err) {
            logger.warn(err)
            return fallback
        }
    }

    ctx.console.addListener(
        'chatluna-agent/getTriggerRoutingChoices',
        async () => agent().trigger.listRoutingChoices(),
        auth
    )

    ctx.console.addListener(
        'chatluna-agent/listTriggerProviders',
        async () => agent().trigger.listProviders(),
        auth
    )

    ctx.console.addListener(
        'chatluna-agent/listTriggers',
        async function (filter) {
            return await agent().trigger.list(consoleActor(this.id), filter)
        },
        auth
    )

    ctx.console.addListener(
        'chatluna-agent/getTrigger',
        async function (id) {
            return await agent().trigger.get(consoleActor(this.id), id)
        },
        auth
    )

    ctx.console.addListener(
        'chatluna-agent/createTrigger',
        async function (input) {
            return await agent().trigger.create(consoleActor(this.id), input)
        },
        auth
    )

    ctx.console.addListener(
        'chatluna-agent/updateTrigger',
        async function (id, input) {
            return await agent().trigger.update(
                consoleActor(this.id),
                id,
                input
            )
        },
        auth
    )

    ctx.console.addListener(
        'chatluna-agent/removeTrigger',
        async function (id: number) {
            await agent().trigger.remove(consoleActor(this.id), id)
            return { success: true }
        },
        auth
    )

    ctx.console.addListener(
        'chatluna-agent/setTriggerEnabled',
        async function (id, enabled) {
            return await agent().trigger.setEnabled(
                consoleActor(this.id),
                id,
                enabled
            )
        },
        auth
    )

    ctx.console.addListener(
        'chatluna-agent/resumeTrigger',
        async function (id) {
            return await agent().trigger.resume(consoleActor(this.id), id)
        },
        auth
    )

    ctx.console.addListener(
        'chatluna-agent/fireTrigger',
        async function (id) {
            return await agent().trigger.fire(consoleActor(this.id), id)
        },
        auth
    )

    ctx.console.addListener(
        'chatluna-agent/listTriggerRuns',
        async function (id, limit) {
            return await agent().trigger.listRuns(
                consoleActor(this.id),
                id,
                limit
            )
        },
        auth
    )

    ctx.console.addListener(
        'chatluna-agent/previewTriggerCondition',
        async (condition, count) =>
            (await agent().trigger.previewCondition(condition, count)).map(
                (date) => date.toISOString()
            ),
        auth
    )

    ctx.console.addListener(
        'chatluna-agent/wakeup',
        async function (input) {
            return await agent().trigger.wakeup(consoleActor(this.id), input)
        },
        auth
    )

    ctx.console.addListener(
        'chatluna-agent/getTriggerTargets',
        async (platform: string, selfId: string) =>
            await withBot(
                platform,
                selfId,
                async (bot) => {
                    const [guildList, friendList] = await Promise.all([
                        bot.getGuildList?.().catch(() => undefined),
                        bot.getFriendList?.().catch(() => undefined)
                    ])
                    return {
                        guilds:
                            guildList?.data.map((g) => ({
                                id: g.id,
                                name: g.name,
                                avatar: g.avatar
                            })) ?? [],
                        friends:
                            friendList?.data.map((u) => ({
                                id: u.id,
                                name: u.name,
                                avatar: u.avatar
                            })) ?? []
                    }
                },
                { guilds: [], friends: [] }
            ),
        auth
    )

    ctx.console.addListener(
        'chatluna-agent/getTriggerChannels',
        async (platform: string, selfId: string, guildId: string) =>
            await withBot(
                platform,
                selfId,
                async (bot) => {
                    if (bot.getChannelList == null) return []
                    const list = await bot.getChannelList(guildId)
                    return list.data.map((c) => ({
                        id: c.id,
                        name: c.name,
                        type: c.type
                    }))
                },
                []
            ),
        auth
    )
}

function consoleActor(id: string): TriggerActor {
    return {
        key: `console:${id}`,
        userId: `console:${id}`,
        authority: 3
    }
}

function registerMcpListeners(ctx: Context, agent: AgentRef) {
    ctx.console.addListener('chatluna-agent/getMcpStatus', async () =>
        agent().mcp.getStatus()
    )

    ctx.console.addListener(
        'chatluna-agent/saveMcp',
        ok((cfg) => agent().saveMcpConfig(cfg))
    )

    ctx.console.addListener(
        'chatluna-agent/upsertMcpServer',
        ok((name: string, cfg: McpServerConfig) =>
            agent().saveMcpServer({ name, config: cfg })
        )
    )

    ctx.console.addListener(
        'chatluna-agent/saveMcpServer',
        ok((input) => agent().saveMcpServer(input))
    )

    ctx.console.addListener(
        'chatluna-agent/removeMcpServer',
        ok((name) => agent().removeMcpServer(name))
    )

    ctx.console.addListener(
        'chatluna-agent/toggleMcpTool',
        ok((name: string, enabled: boolean) => {
            const tool = agent().getConsoleData().config.mcp.tools[name]
            return agent().saveMcpTool({
                name,
                enabled,
                timeout: tool?.timeout,
                selector: tool?.selector ?? []
            })
        })
    )

    ctx.console.addListener(
        'chatluna-agent/saveMcpTool',
        ok((tool) => agent().saveMcpTool(tool))
    )

    ctx.console.addListener(
        'chatluna-agent/reloadMcp',
        ok(() => agent().reloadMcp())
    )

    ctx.console.addListener(
        'chatluna-agent/reconnectMcpServer',
        ok((name) => agent().mcp.reconnect(name))
    )
}

export function apply(ctx: Context) {
    ctx.console.addEntry({
        dev: resolve(__dirname, '../client/index.ts'),
        prod: resolve(__dirname, '../dist')
    })

    ctx.plugin(ChatLunaAgentConsoleService)

    const agent = () => ctx.chatluna_agent

    registerBaseListeners(ctx, agent)
    registerMcpListeners(ctx, agent)
    registerSkillsListeners(ctx, agent)
    registerComputerListeners(ctx, agent)
    registerSubAgentListeners(ctx, agent)
    registerToolListeners(ctx, agent)
    registerTriggerListeners(ctx, agent)
}

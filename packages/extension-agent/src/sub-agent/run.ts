/** @module sub-agent/run */

import { HumanMessage } from '@langchain/core/messages'
import {
    createAgentTool,
    type AgentGenerateOptions,
    type AgentToolOptions,
    type ChatLunaAgent,
    type ToolMask
} from 'koishi-plugin-chatluna/llm-core/agent'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import { ChatLunaTool } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { computed, ComputedRef } from 'koishi-plugin-chatluna'
import { Context, h, Session } from 'koishi'
import { getRemoteSkillsRoot } from '../computer/materialize'
import { getSkillsRootPath } from '../config/path'
import { ChatLunaAgentPermissionService } from '../service/permissions'
import { renderAvailableSkills } from '../skills/render'
import { SubAgentInfo } from '../types'
import { renderSubAgentSystemPrompt } from './render'

export interface CreateSubAgentOptions {
    ctx: Context
    permission: ChatLunaAgentPermissionService
    info: SubAgentInfo
    mask: ToolMask
    model?: ChatLunaChatModel
}

export async function createSubAgent(
    options: CreateSubAgentOptions
): Promise<ChatLunaAgent> {
    const agent: ChatLunaAgent = {
        id: options.info.id,
        name: options.info.name,
        description: options.info.description,
        async generate(input) {
            const base = await createInnerAgent(options, input)
            const prompt = await createPromptMessage(
                options.ctx,
                options.info,
                input.prompt,
                input.session,
                base.llm.modelName
            )

            return await base.agent.generate({
                ...input,
                prompt
            })
        },
        async stream(input) {
            const base = await createInnerAgent(options, input)
            const prompt = await createPromptMessage(
                options.ctx,
                options.info,
                input.prompt,
                input.session,
                base.llm.modelName
            )

            return await base.agent.stream({
                ...input,
                prompt
            })
        },
        asTool(toolOptions?: AgentToolOptions) {
            return createAgentTool(agent, toolOptions)
        }
    }

    return agent
}

async function createInnerAgent(
    options: CreateSubAgentOptions,
    input: AgentGenerateOptions
) {
    const llm = await resolveModel(options.ctx, options.info, options.model)
    const embeddings = await resolveEmbeddings(options.ctx)
    const skills = await resolveSkillPrompt(
        options.ctx,
        options.permission,
        options.info
    )
    const computer = options.ctx.chatluna_agent?.computer
    const backends = computer
        ? options.permission.filterComputerBackends(
              options.info,
              computer.listAvailableBackends()
          )
        : []
    const subCtx =
        input.subagentContext ??
        createFallbackSubagentContext(options.info, options.mask, input)
    const system = renderSubAgentSystemPrompt(
        options.info,
        subCtx,
        skills,
        backends.length > 0 && computer?.getStatus().enabled
            ? {
                  enabled: true,
                  backends,
                  capabilities: Array.from(
                      new Set(
                          backends.flatMap((item) =>
                              computer.getCapabilities(item)
                          )
                      )
                  )
              }
            : undefined
    )

    return {
        llm,
        agent: await options.ctx.chatluna.createAgent({
            id: options.info.id,
            name: options.info.name,
            description: options.info.description,
            model: llm,
            embeddings,
            tools: createTools(options.ctx, options.mask),
            system,
            preset:
                options.info.promptMode === 'preset'
                    ? options.info.preset
                    : undefined,
            mode: 'tool-calling',
            maxSteps: options.info.maxTurns,
            handleParsingErrors: true
        })
    }
}

function createFallbackSubagentContext(
    info: SubAgentInfo,
    mask: ToolMask,
    input: AgentGenerateOptions
) {
    return {
        agentId: info.id,
        agentName: info.name,
        parentConversationId: input.conversationId ?? '',
        depth: 1,
        maxDepth: 1,
        toolMask: mask,
        disableHandoff: true,
        traceInfo: {
            runId: info.id,
            parentAgent: 'main',
            startedAt: Date.now()
        }
    }
}

function createTools(
    ctx: Context,
    mask: ToolMask
): ComputedRef<ChatLunaTool[]> {
    return computed(() =>
        ctx.chatluna.platform
            .getFilteredTools(mask)
            .map((name) => ctx.chatluna.platform.getTool(name))
    )
}

async function resolveModel(
    ctx: Context,
    info: SubAgentInfo,
    parent?: ChatLunaChatModel
) {
    if (!info.model) {
        if (!parent) {
            throw new Error('Parent model is missing for sub-agent inheritance')
        }

        return parent
    }

    const ref = await ctx.chatluna.createChatModel(info.model)
    if (!ref.value) {
        throw new Error(`Model not found: ${info.model}`)
    }
    return ref.value
}

async function resolveEmbeddings(ctx: Context) {
    const [platform, model] = parseRawModelName(
        ctx.chatluna.config.defaultEmbeddings
    )
    const ref = await ctx.chatluna.createEmbeddings(platform, model)
    return ref.value as ChatLunaBaseEmbeddings
}

async function resolveSkillPrompt(
    ctx: Context,
    permission: ChatLunaAgentPermissionService,
    info: SubAgentInfo
) {
    const service = ctx.chatluna_agent?.skills
    if (!service) return undefined
    if (!permission.canUseTool(info, 'skill')) return undefined

    const skills = permission.filterSkills(
        info,
        service.listSkills().filter((item) => item.modelEnabled)
    )
    if (skills.length < 1) return undefined

    const cwd = ctx.chatluna_agent?.computer.getPromptWorkdir()
    const status = ctx.chatluna_agent?.computer.getStatus()
    const remote = status != null && status.defaultProvider !== 'local'

    return getMessageContent(
        renderAvailableSkills(
            skills.map((item) => (remote ? { ...item, dir: '' } : item)),
            [],
            remote ? getRemoteSkillsRoot() : getSkillsRootPath(ctx),
            cwd,
            remote ? 'remote' : 'local'
        ).content
    )
}

async function createPromptMessage(
    ctx: Context,
    info: SubAgentInfo,
    prompt: string | HumanMessage,
    session: Session | undefined,
    modelName: string
) {
    if (prompt instanceof HumanMessage || typeof prompt !== 'string') {
        return prompt
    }

    if (!info.allowKoishiMessageTransform || !session) {
        return new HumanMessage(prompt)
    }

    const msg = await ctx.chatluna.messageTransformer.transform(
        session,
        h.parse(prompt),
        modelName
    )
    return new HumanMessage({
        content: msg.content,
        name: msg.name,
        id: session.userId,
        additional_kwargs: { ...msg.additional_kwargs }
    })
}

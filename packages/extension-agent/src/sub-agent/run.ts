/** @module sub-agent/run */

import { HumanMessage } from '@langchain/core/messages'
import {
    type AgentGenerateOptions,
    type AgentToolOptions,
    applyToolMask,
    type ChatLunaAgent,
    createAgentTool
} from 'koishi-plugin-chatluna/llm-core/agent'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { computed } from 'koishi-plugin-chatluna'
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
                prompt,
                toolMask: base.toolMask,
                subagentContext: base.subCtx
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
                prompt,
                toolMask: base.toolMask,
                subagentContext: base.subCtx
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
    const toolMask = await options.permission.createSubAgentToolMask(
        options.info,
        input.session,
        input.source ?? 'chatluna'
    )

    let llm: ChatLunaChatModel
    if (!options.info.model) {
        if (!options.model) {
            throw new Error('Parent model is missing for sub-agent inheritance')
        }
        llm = options.model
    } else {
        const ref = await options.ctx.chatluna.createChatModel(
            options.info.model
        )
        if (!ref.value) {
            throw new Error(`Model not found: ${options.info.model}`)
        }
        llm = ref.value
    }

    const [platform, embModel] = parseRawModelName(
        options.ctx.chatluna.config.defaultEmbeddings
    )
    const embeddings = (
        await options.ctx.chatluna.createEmbeddings(platform, embModel)
    ).value as ChatLunaBaseEmbeddings

    const service = options.ctx.chatluna_agent?.skills
    const toolCallMask = toolMask.toolCallMask ?? toolMask
    let skills: string | undefined
    if (
        service &&
        applyToolMask('skill', toolCallMask) &&
        options.permission.canUseTool(options.info, 'skill')
    ) {
        const filtered = options.permission.filterSkills(
            options.info,
            service.listSkills().filter((item) => item.modelEnabled)
        )
        if (filtered.length > 0) {
            const cwd = options.ctx.chatluna_agent?.computer?.getPromptWorkdir()
            const status = options.ctx.chatluna_agent?.computer?.getStatus()
            const remote = status != null && status.defaultProvider !== 'local'
            skills = getMessageContent(
                renderAvailableSkills(
                    filtered.map((item) =>
                        remote ? { ...item, dir: '' } : item
                    ),
                    [],
                    remote
                        ? getRemoteSkillsRoot()
                        : getSkillsRootPath(options.ctx),
                    cwd,
                    remote ? 'remote' : 'local'
                ).content
            )
        }
    }

    const computer = options.ctx.chatluna_agent?.computer
    const backends = computer
        ? options.permission.filterComputerBackends(
              options.info,
              computer.listAvailableBackends()
          )
        : []

    const subCtx =
        input.subagentContext != null
            ? { ...input.subagentContext, toolMask }
            : {
                  agentId: options.info.id,
                  agentName: options.info.name,
                  parentConversationId: input.conversationId ?? '',
                  depth: 1,
                  maxDepth: 1,
                  toolMask,
                  disableHandoff: true,
                  traceInfo: {
                      runId: options.info.id,
                      parentAgent: 'main',
                      startedAt: Date.now()
                  }
              }

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

    const tools = options.ctx.chatluna.platform.getTools()

    return {
        llm,
        toolMask,
        subCtx,
        agent: await options.ctx.chatluna.createAgent({
            id: options.info.id,
            name: options.info.name,
            description: options.info.description,
            model: llm,
            embeddings,
            tools: computed(() =>
                tools.value
                    .filter((name) =>
                        options.permission.canUseTool(options.info, name)
                    )
                    .map((name) => options.ctx.chatluna.platform.getTool(name))
            ),
            system,
            preset:
                options.info.promptMode === 'preset'
                    ? options.info.preset
                    : undefined,
            mode: 'tool-calling',
            maxSteps: options.info.maxTurns,
            handleParsingErrors: true,
            toolMask
        })
    }
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

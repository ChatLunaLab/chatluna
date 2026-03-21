/** @module sub-agent/run */

import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { computed, ComputedRef } from 'koishi-plugin-chatluna'
import {
    createAgentExecutor,
    createToolsRef,
    MessageQueue,
    SubagentContext,
    ToolMask
} from 'koishi-plugin-chatluna/llm-core/agent'
import { ChatLunaChatPrompt } from 'koishi-plugin-chatluna/llm-core/chain/prompt'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import { ChatLunaTool } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { Context, h, Session } from 'koishi'
import { getRemoteSkillsRoot } from '../computer/materialize'
import { getSkillsRootPath } from '../config/path'
import { ChatLunaAgentPermissionService } from '../service/permissions'
import { renderAvailableSkills } from '../skills/render'
import { renderSubAgentSystemPrompt } from './render'
import {
    appendTaskMessage,
    appendTaskMessages,
    appendTaskToolBatch,
    SubAgentTaskSession
} from './session'
import { SubAgentInfo, SubAgentRunInfo } from '../types'

export async function runSubAgentTurn(input: RunSubAgentTurnOptions) {
    const llm = await resolveModel(input.ctx, input.info, input.model)
    const embeddings = await resolveEmbeddings(input.ctx)
    const skills = await resolveSkillPrompt(
        input.ctx,
        input.permission,
        input.info
    )
    const computer = input.ctx.chatluna_agent?.computer
    const backends = computer
        ? input.permission.filterComputerBackends(
              input.info,
              computer.listAvailableBackends()
          )
        : []
    const systemPrompt = renderSubAgentSystemPrompt(
        input.info,
        input.subCtx,
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

    const preset = computed(
        () =>
            ({
                triggerKeyword: [input.info.name],
                rawText: systemPrompt,
                messages: systemPrompt ? [new SystemMessage(systemPrompt)] : [],
                config:
                    input.info.promptMode === 'preset' && input.info.preset
                        ? (input.ctx.chatluna.preset.getPreset(
                              input.info.preset
                          ).value?.config ?? {})
                        : {}
            }) satisfies PresetTemplate
    )

    const chatPrompt = computed(
        () =>
            new ChatLunaChatPrompt({
                preset,
                tokenCounter: (text) => llm.getNumTokens(text),
                sendTokenLimit:
                    llm.invocationParams().maxTokenLimit ??
                    llm.getModelMaxContextSize(),
                contextManager: input.ctx.chatluna.contextManager,
                promptRenderService: input.ctx.chatluna.promptRenderer
            })
    )

    const toolRef = createToolsRef({
        tools: createTools(input.ctx, input.mask),
        embeddings,
        toolMask: input.mask
    })

    const executor = createAgentExecutor({
        llm: computed(() => llm),
        tools: toolRef.tools,
        prompt: chatPrompt.value,
        agentMode: 'tool-calling',
        maxIterations: input.info.maxTurns,
        returnIntermediateSteps: false,
        handleParsingErrors: true,
        instructions: computed(() => undefined)
    })

    const msg = await createMessage(
        input.ctx,
        input.info,
        input.prompt,
        input.session,
        llm.modelName
    )
    toolRef.update(input.session, input.task.messages.concat(msg), input.mask)
    const toolCallMask = await input.permission.createToolCallMask(
        input.session,
        input.mask
    )
    const subCtx = {
        ...input.subCtx,
        toolMask: {
            ...input.mask,
            toolCallMask
        }
    }

    const vars = {
        prompt: getMessageContent(msg.content),
        built: {
            conversationId: input.task.conversationId,
            session: input.session
        }
    }

    let hasSavedUser = false

    const saveUser = () => {
        if (hasSavedUser) {
            return
        }

        appendTaskMessage(input.task, msg)
        hasSavedUser = true
    }

    const result = await executor.value.invoke(
        {
            input: msg,
            chat_history: [...input.task.messages],
            variables: vars,
            variables_hide: vars,
            configurable: {
                session: input.session,
                conversationId: input.task.conversationId,
                toolMask: input.mask,
                subagentContext: subCtx
            }
        },
        {
            signal: input.signal,
            configurable: {
                session: input.session,
                model: llm,
                messageQueue: input.messageQueue,
                conversationId: input.task.conversationId,
                preset: input.info.name,
                userId: input.session.userId,
                toolMask: input.mask,
                subagentContext: subCtx,
                onAgentEvent: async (event) => {
                    if (event.type === 'tool-call') {
                        input.run.toolCount += event.actions.length
                        input.run.lastTool =
                            event.actions[event.actions.length - 1]?.tool
                    }

                    if (event.type === 'tool-result') {
                        saveUser()
                        appendTaskToolBatch(input.task, event.steps)
                    }

                    if (event.type === 'human-update') {
                        saveUser()
                        appendTaskMessages(input.task, event.messages)
                    }

                    if (event.type === 'round-decision') {
                        input.run.turnCount += 1
                    }

                    await input.refresh()
                }
            }
        }
    )

    if (getMessageContent(result.message.content).trim().length > 0) {
        saveUser()
        appendTaskMessage(input.task, result.message)
    }

    return result
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
    if (!ref.value) throw new Error(`Model not found: ${info.model}`)
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

    const skills = service.listSkills().filter((item) => item.modelEnabled)
    const list = permission.filterSkillNames(
        info,
        skills.map((item) => item.name)
    )
    const cwd = ctx.chatluna_agent?.computer.getPromptWorkdir()
    const status = ctx.chatluna_agent?.computer.getStatus()
    const remote = status != null && status.defaultProvider !== 'local'

    return getMessageContent(
        renderAvailableSkills(
            skills
                .filter((item) => list.includes(item.name))
                .map((item) => (remote ? { ...item, dir: '' } : item)),
            [],
            remote ? getRemoteSkillsRoot() : getSkillsRootPath(ctx),
            cwd,
            remote ? 'remote' : 'local'
        ).content
    )
}

async function createMessage(
    ctx: Context,
    info: SubAgentInfo,
    prompt: string,
    session: Session,
    modelName: string
) {
    if (!info.allowKoishiMessageTransform) {
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

export interface RunSubAgentTurnOptions {
    ctx: Context
    permission: ChatLunaAgentPermissionService
    info: SubAgentInfo
    prompt: string
    session: Session
    task: SubAgentTaskSession
    subCtx: SubagentContext
    mask: ToolMask
    run: SubAgentRunInfo
    refresh: () => Promise<void>
    signal?: AbortSignal
    model?: ChatLunaChatModel
    messageQueue?: MessageQueue
}

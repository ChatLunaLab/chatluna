import { SystemMessage } from '@langchain/core/messages'
import { StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import type {
    AgentTaskDescriptor,
    AgentTaskInput,
    AgentTaskToolRuntime
} from './types'
import { escapeXml } from './utils'
import type { ChatLunaToolRunnable } from '../../platform/types'

export function buildTaskToolDescription() {
    return [
        'Delegate focused work to a specialist agent (exact name required).',
        'Set background=true for long tasks; results are delivered to you automatically - never poll status.',
        'Actions: run (new task, or resume with id), status, list, list_all, message (guide a running background task), stop (abort a running background task).'
    ].join('\n')
}

export function renderAvailableAgents(
    agents: AgentTaskDescriptor[],
    dir?: string,
    location: 'local' | 'remote' = 'local'
) {
    const lines = [
        '<available_sub_agents>',
        'Delegate via the task tool. background=true for long work; results arrive automatically - do not poll status.',
        ''
    ]
    if (dir) {
        lines.push(
            `Sub-agents dir (${location}): ${escapeXml(dir)}`,
            'When a task creates or updates a markdown sub-agent, place it under <sub-agents-dir>/<name>/index.md.',
            ''
        )
    }
    for (const item of agents) {
        lines.push(
            `<sub_agent name="${escapeXml(item.name)}">${escapeXml(item.description)}</sub_agent>`
        )
    }
    lines.push(
        '',
        'Use exact names. Include goal, context, and expected result in the prompt.',
        '</available_sub_agents>'
    )
    return new SystemMessage(lines.join('\n'))
}

class AgentTaskTool extends StructuredTool {
    name: string
    description: string
    schema = z
        .object({
            action: z
                .enum(['run', 'status', 'list', 'list_all', 'message', 'stop'])
                .optional()
                .describe(
                    'run/resume task, status inspects one, list shows current conversation tasks, ' +
                        'list_all shows every task, message guides a running background task, ' +
                        'stop aborts a running background task.'
                ),
            agent: z
                .string()
                .optional()
                .describe(
                    'Exact agent name. Required for new tasks; optional when resuming by id.'
                ),
            id: z
                .string()
                .optional()
                .describe('Existing task id for status, message, or resume.'),
            prompt: z
                .string()
                .optional()
                .describe(
                    'Task or follow-up instruction. Required for run. ' +
                        'Use goal for the structured Markdown objective.'
                ),
            goal: z
                .string()
                .optional()
                .describe(
                    'Markdown goal block for the sub-agent. Include objective, scope, success criteria, expected output, and constraints.'
                ),
            reason: z
                .string()
                .optional()
                .describe('Optional reason for delegating the task'),
            background: z
                .boolean()
                .optional()
                .describe('Run in background for long work.'),
            message: z
                .string()
                .optional()
                .describe('Guidance for a running background task.')
        })
        .superRefine((val, ctx) => {
            const action = val.action ?? 'run'
            if (action === 'run' && !val.prompt?.trim()) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['prompt'],
                    message: 'prompt is required when action is run.'
                })
            }
            if (
                ['status', 'message', 'stop'].includes(action) &&
                !val.id?.trim()
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['id'],
                    message:
                        'id is required when action is status, message, or stop.'
                })
            }
            if (action === 'message' && !val.message?.trim()) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['message'],
                    message: 'message is required when action is message.'
                })
            }
        })

    constructor(
        name: string,
        private _runtime: AgentTaskToolRuntime
    ) {
        super()
        this.name = name
        this.description = _runtime.buildToolDescription()
    }

    async _call(
        input: AgentTaskInput,
        _: unknown,
        runConfig?: ChatLunaToolRunnable
    ) {
        return this._runtime.runTask(input, runConfig)
    }
}

export { AgentTaskTool }

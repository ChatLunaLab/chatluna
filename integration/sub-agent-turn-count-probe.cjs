const assert = require('node:assert/strict')

const { AIMessage } = require('@langchain/core/messages')
const { DynamicStructuredTool } = require('@langchain/core/tools')
const { z } = require('zod')
const {
    createTaskTool,
    runAgent
} = require('koishi-plugin-chatluna/llm-core/agent')

let plans = 0
let decisions = 0
const action = {
    tool: 'probe',
    toolInput: {},
    toolCallId: 'probe-call',
    log: 'Call the probe tool.'
}
const planner = {
    async stream() {
        plans += 1
        const output =
            plans === 1
                ? action
                : {
                      returnValues: {
                          output: 'finished',
                          message: new AIMessage('finished')
                      },
                      log: 'Finish after the tool result.'
                  }
        return (async function* () {
            yield output
        })()
    }
}
const tool = new DynamicStructuredTool({
    name: 'probe',
    description: 'Return a deterministic probe result.',
    schema: z.object({}),
    func: async () => 'probe result'
})
const agent = {
    id: 'turn-count-probe',
    name: 'turn-count-probe',
    description: '',
    async generate(input) {
        for await (const event of runAgent({
            agent: planner,
            tools: [tool],
            input: {},
            signal: input.signal
        })) {
            if (event.type === 'round-decision') decisions += 1
            await input.onStep?.(event)
            if (event.type === 'done') {
                return {
                    output: event.output,
                    message: event.message ?? new AIMessage(event.output)
                }
            }
        }
        throw new Error('Agent did not finish')
    }
}
const runtime = createTaskTool({
    list: () => [],
    get: () => ({ agent })
})
const session = {
    app: {
        chatluna: {
            resolveCallbacks: async () => undefined
        }
    },
    platform: 'probe',
    selfId: 'bot',
    userId: 'user',
    guildId: 'guild',
    channelId: 'channel',
    isDirect: false
}

async function main() {
    try {
        await runtime.runTask(
            {
                action: 'run',
                agent: agent.name,
                prompt: 'Use the tool, then finish.'
            },
            {
                configurable: {
                    session,
                    agentContext: {
                        kind: 'primary',
                        agentId: 'parent',
                        agentName: 'parent',
                        conversationId: 'conversation',
                        requestId: 'request',
                        source: 'chatluna',
                        userId: session.userId,
                        guildId: session.guildId,
                        channelId: session.channelId
                    }
                }
            }
        )

        const run = runtime.getRuns()[0]
        assert.equal(plans, 2)
        assert.equal(run.toolCount, 1)
        assert.equal(run.turnCount, plans)
        assert(decisions > plans)
        process.stdout.write(
            `${JSON.stringify({ plans, decisions, turnCount: run.turnCount })}\n`
        )
    } finally {
        await runtime.dispose()
    }
}

main().catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`)
    process.exitCode = 1
})

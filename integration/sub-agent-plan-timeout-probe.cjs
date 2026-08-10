const assert = require('node:assert/strict')

const { AIMessage } = require('@langchain/core/messages')
const { DynamicStructuredTool } = require('@langchain/core/tools')
const { z } = require('zod')
const { runAgent } = require('koishi-plugin-chatluna/llm-core/agent')
const {
    ChatLunaError,
    ChatLunaErrorCode
} = require('koishi-plugin-chatluna/utils/error')

const write = {
    tool: 'file_write',
    toolInput: {
        filePath: 'src/feature.ts',
        content: 'export const feature = true\n'
    },
    toolCallId: 'write',
    log: 'Write the implementation.'
}
const verify = {
    tool: 'bash',
    toolInput: { command: 'yarn test' },
    toolCallId: 'verify',
    log: 'Verify the implementation.'
}
const finish = {
    returnValues: {
        output: 'Planner finished the task.',
        message: new AIMessage('Planner finished the task.')
    },
    log: 'Finish after verification.'
}
const tools = [
    new DynamicStructuredTool({
        name: 'file_write',
        description: 'Write an implementation file.',
        schema: z.object({
            filePath: z.string(),
            content: z.string()
        }),
        func: async (input) => `Wrote ${input.filePath}`
    }),
    new DynamicStructuredTool({
        name: 'bash',
        description: 'Run a verification command.',
        schema: z.object({ command: z.string() }),
        func: async (input) =>
            ({
                'bash verification.sh': 'value=42',
                'node clean-values.js': '{"value":42}',
                'npm test': '3 tests',
                'node -e "console.log(\'passed\')"': '3 tests passed',
                'node diagnostics.js': '3 tests passed',
                'python diagnostics.py': 'verification succeeded',
                'yarn test --success': '3 tests passed',
                'npm run lint': 'Lint completed successfully',
                'npx vitest run': 'Tests: 3 passed',
                'yarn test --bad': 'BAD',
                'yarn test --oops': 'Oops',
                'yarn test --couldnt': "couldn't verify value",
                'yarn test --could-not': 'could not verify value',
                'yarn test --exit-colon': 'exit: 2',
                'yarn test --exit-equals': 'exit=2',
                'yarn test --failed': 'SOME TESTS FAILED',
                'yarn test --assert': 'assert',
                'yarn test --error': 'error',
                'yarn test --timeout': 'timeout',
                'yarn test --permission': 'permission denied',
                'yarn test --empty': '',
                'yarn test --skipped': '2 tests passed, 1 skipped',
                'yarn test --unavailable': 'Tests unavailable',
                'yarn test --not-installed': 'Test runner is not installed'
            })[input.command]
    })
]

async function run(
    kind,
    actions,
    controller,
    abortReason,
    code = ChatLunaErrorCode.API_REQUEST_TIMEOUT
) {
    let call = 0
    const planner = {
        async stream() {
            if (call < actions.length) {
                const output = actions[call++]
                return (async function* () {
                    yield output
                })()
            }

            if (abortReason) controller.abort(abortReason)
            throw new ChatLunaError(code, undefined, true)
        }
    }
    const events = []

    for await (const event of runAgent({
        agent: planner,
        tools,
        input: {},
        signal: controller?.signal,
        config: {
            configurable: {
                agentContext: {
                    kind,
                    agentId: 'probe',
                    agentName: 'probe',
                    conversationId: 'probe',
                    requestId: 'probe',
                    source: 'chatluna'
                }
            }
        }
    })) {
        events.push(event)
    }

    return events
}

async function main() {
    const changed = await run('subagent', [write])
    const done = changed.at(-1)
    assert.equal(done.type, 'done')
    assert.match(
        done.output,
        /workspace changes were applied but final model response failed/i
    )
    assert.equal(done.steps.length, 1)
    assert.deepEqual(
        changed.slice(-2).map((event) => event.type),
        ['round-decision', 'done']
    )
    assert.equal(changed.at(-2).canContinue, false)

    const failed = await run(
        'subagent',
        [write],
        undefined,
        undefined,
        ChatLunaErrorCode.API_REQUEST_FAILED
    )
    assert.equal(failed.at(-1).type, 'done')
    assert.match(
        failed.at(-1).output,
        /workspace changes were applied but final model response failed/i
    )
    assert.equal(failed.at(-1).steps.length, 1)

    await assert.rejects(
        () =>
            run(
                'subagent',
                [],
                undefined,
                undefined,
                ChatLunaErrorCode.API_REQUEST_FAILED
            ),
        { errorCode: ChatLunaErrorCode.API_REQUEST_FAILED }
    )

    await assert.rejects(() => run('subagent', []), {
        errorCode: ChatLunaErrorCode.API_REQUEST_TIMEOUT
    })
    await assert.rejects(() => run('main', [write]), {
        errorCode: ChatLunaErrorCode.API_REQUEST_TIMEOUT
    })

    const controller = new AbortController()
    const reason = new Error('parent aborted')
    await assert.rejects(
        () => run('subagent', [write], controller, reason),
        (err) => err === reason
    )

    const failedController = new AbortController()
    const failedReason = new Error('parent aborted after API request failure')
    await assert.rejects(
        () =>
            run(
                'subagent',
                [write],
                failedController,
                failedReason,
                ChatLunaErrorCode.API_REQUEST_FAILED
            ),
        (err) => err === failedReason
    )

    for (const command of [
        'yarn test --success',
        'npm run lint',
        'npx vitest run'
    ]) {
        const continued = await run('subagent', [
            write,
            { ...verify, toolInput: { command } }
        ])
        assert.equal(continued.at(-1).type, 'done')
        assert.equal(continued.at(-1).steps.length, 2)
        assert.match(
            continued.at(-1).output,
            /workspace changes were applied but final model response failed/i
        )
    }

    const plannerFinished = await run('subagent', [
        write,
        {
            ...verify,
            toolInput: { command: 'yarn test --success' }
        },
        finish
    ])
    assert.equal(plannerFinished.at(-1).type, 'done')
    assert.equal(plannerFinished.at(-1).output, 'Planner finished the task.')
    assert.equal(plannerFinished.at(-1).steps.length, 2)
    assert.equal(plannerFinished.at(-1).log, 'Finish after verification.')

    for (const command of [
        'bash verification.sh',
        'node clean-values.js',
        'npm test',
        'node -e "console.log(\'passed\')"',
        'node diagnostics.js',
        'python diagnostics.py',
        'yarn test --bad',
        'yarn test --oops',
        'yarn test --couldnt',
        'yarn test --could-not',
        'yarn test --exit-colon',
        'yarn test --exit-equals',
        'yarn test --failed',
        'yarn test --assert',
        'yarn test --error',
        'yarn test --timeout',
        'yarn test --permission',
        'yarn test --empty',
        'yarn test --skipped',
        'yarn test --unavailable',
        'yarn test --not-installed'
    ]) {
        const continued = await run('subagent', [
            write,
            { ...verify, toolInput: { command } }
        ])
        assert.equal(continued.at(-1).type, 'done')
        assert.equal(continued.at(-1).steps.length, 2)
        assert.match(
            continued.at(-1).output,
            /workspace changes were applied but final model response failed/i
        )
    }

    await assert.rejects(
        () =>
            run('main', [
                write,
                {
                    ...verify,
                    toolInput: { command: 'yarn test --success' }
                }
            ]),
        { errorCode: ChatLunaErrorCode.API_REQUEST_TIMEOUT }
    )
    await assert.rejects(
        () =>
            run('subagent', [
                {
                    ...write,
                    toolInput: {
                        filePath: 'scratch.ts',
                        content: 'export const scratch = true\n'
                    }
                },
                {
                    ...verify,
                    toolInput: { command: 'yarn test --success' }
                }
            ]),
        { errorCode: ChatLunaErrorCode.API_REQUEST_TIMEOUT }
    )

    process.stdout.write(
        `${JSON.stringify({
            writeThenTimeout: 'done',
            noWrite: 'threw',
            mainAgent: 'threw',
            parentAbort: 'threw',
            trustedVerification: 'continued',
            adHocVerification: 'continued',
            failedVerification: 'continued',
            skippedVerification: 'continued',
            emptyVerification: 'continued',
            scratchFile: 'threw',
            plannerFinish: 'done'
        })}\n`
    )
}

main().catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`)
    process.exitCode = 1
})

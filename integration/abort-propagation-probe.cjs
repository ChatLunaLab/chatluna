const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { Context } = require('koishi')
const memory = require('@koishijs/plugin-database-memory').default
const server = require('@koishijs/plugin-server').default
const NodeConsole = require('@koishijs/plugin-console').default
const chatluna = require('koishi-plugin-chatluna')
const agent = require('koishi-plugin-chatluna-agent')
const { sseIterable } = require('koishi-plugin-chatluna/utils/sse')

async function waitForFile(file, timeout = 2000) {
    const started = Date.now()
    while (Date.now() - started < timeout) {
        try {
            return await fs.readFile(file, 'utf8')
        } catch (err) {
            if (err.code !== 'ENOENT') throw err
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`Process did not write ${file} within ${timeout}ms`)
}

async function assertGone(pid, timeout = 1500) {
    const started = Date.now()
    while (Date.now() - started < timeout) {
        try {
            process.kill(pid, 0)
        } catch (err) {
            if (err.code === 'ESRCH') return
            throw err
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`Process ${pid} survived process-group termination`)
}

async function probeSse() {
    const controller = new AbortController()
    const signal = controller.signal
    const add = signal.addEventListener.bind(signal)
    const remove = signal.removeEventListener.bind(signal)
    let listeners = 0
    let canceled = false
    let cancelReason

    Object.defineProperty(signal, 'addEventListener', {
        value(type, callback, options) {
            if (type === 'abort') listeners += 1
            return add(type, callback, options)
        }
    })
    Object.defineProperty(signal, 'removeEventListener', {
        value(type, callback, options) {
            if (type === 'abort') listeners -= 1
            return remove(type, callback, options)
        }
    })

    const body = new ReadableStream({
        cancel(reason) {
            canceled = true
            cancelReason = reason
        }
    })
    const task = (async () => {
        for await (const _event of sseIterable(
            new Response(body),
            60000,
            signal
        )) {
            assert.fail('Hanging SSE stream yielded an event')
        }
    })()
    await new Promise((resolve) => setTimeout(resolve, 20))

    const reason = new Error('SSE probe aborted')
    const started = Date.now()
    controller.abort(reason)
    await assert.rejects(task, (err) => err === reason)

    assert(Date.now() - started < 1000)
    assert.equal(canceled, true)
    assert.equal(cancelReason, reason)
    assert.equal(listeners, 0)

    return Date.now() - started
}

async function main() {
    const root = await fs.mkdtemp(
        path.join(os.tmpdir(), 'chatluna-abort-probe-')
    )
    const scope = path.join(root, 'agent')
    const configPath = path.join(root, 'data/chatluna/agents/config.json')
    const pids = []
    const app = new Context()
    const forks = []
    let session

    try {
        await fs.mkdir(scope, { recursive: true })
        await fs.mkdir(path.dirname(configPath), { recursive: true })
        await fs.writeFile(
            path.join(scope, 'sleeper.cjs'),
            "require('node:fs').writeFileSync(process.argv[2], String(process.pid))\n" +
                'setInterval(() => {}, 1000)\n',
            'utf8'
        )
        await fs.writeFile(
            configPath,
            JSON.stringify(
                {
                    version: 4,
                    computer: {
                        defaultProvider: 'local',
                        local: {
                            enabled: true,
                            sandboxMode: 'workspace-write',
                            approvalMode: 'never',
                            dangerouslySkipPermissions: true,
                            preferredShell: 'auto',
                            scopePath: scope,
                            readOnlyRoots: [],
                            denyRoots: [],
                            ignores: [],
                            allowedCommands: [],
                            blockedCommands: [],
                            commandTimeoutMs: 300,
                            networkPolicy: 'block'
                        }
                    }
                },
                null,
                4
            ) + '\n',
            'utf8'
        )

        const sseMs = await probeSse()

        app.baseDir = root
        forks.push(app.plugin(memory))
        forks.push(app.plugin(server, { host: '127.0.0.1', port: 0 }))
        forks.push(app.plugin(NodeConsole, { open: false }))
        forks.push(
            app.plugin(chatluna, {
                defaultModel: 'none',
                defaultEmbeddings: 'none'
            })
        )
        forks.push(app.plugin(agent))
        await app.start()

        session = await app.chatluna_agent.computer.getOrCreateSession({
            backend: 'local',
            conversationId: 'abort-probe'
        })

        const controller = new AbortController()
        const aborted = session.execute('node sleeper.cjs abort.pid', {
            timeout: 300000,
            signal: controller.signal
        })
        const abortPid = Number(
            await waitForFile(path.join(scope, 'abort.pid'))
        )
        pids.push(abortPid)
        const reason = new Error('local command aborted')
        const abortStarted = Date.now()
        controller.abort(reason)
        await assert.rejects(aborted, (err) => err === reason)
        const abortMs = Date.now() - abortStarted
        assert(abortMs < 2000)
        await assertGone(abortPid)

        const timeoutStarted = Date.now()
        const timedOut = await session.execute('node sleeper.cjs timeout.pid')
        const timeoutMs = Date.now() - timeoutStarted
        const timeoutPid = Number(
            await waitForFile(path.join(scope, 'timeout.pid'))
        )
        pids.push(timeoutPid)
        assert.equal(timedOut.timedOut, true)
        assert(timeoutMs < 2000)
        await assertGone(timeoutPid)

        process.stdout.write(
            JSON.stringify({
                probe: 'abort-propagation',
                sse: {
                    abortMs: sseMs,
                    sameReason: true,
                    readerCanceled: true,
                    listeners: 0
                },
                local: {
                    abortMs,
                    sameReason: true,
                    processGroupTerminated: true,
                    commandTimeoutMs: timeoutMs,
                    commandTimedOut: true
                }
            }) + '\n'
        )
    } finally {
        for (const pid of pids) {
            try {
                process.kill(pid, 'SIGKILL')
            } catch {}
        }
        if (session?.isConnected()) await session.disconnect()
        for (const fork of forks.reverse()) fork.dispose()
        await app.lifecycle.flush()
        await app.stop()
        await fs.rm(root, { recursive: true, force: true })
    }
}

main().catch((err) => {
    process.stderr.write(`${err.stack || err.message || String(err)}\n`)
    process.exitCode = 1
})

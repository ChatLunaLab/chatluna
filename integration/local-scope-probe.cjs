const assert = require('assert/strict')
const { execFileSync } = require('child_process')
const { createServer } = require('net')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')

const { Context } = require('koishi')
const memory = require('@koishijs/plugin-database-memory').default
const server = require('@koishijs/plugin-server').default
const NodeConsole = require('@koishijs/plugin-console').default
const chatluna = require('koishi-plugin-chatluna')
const agent = require('koishi-plugin-chatluna-agent')

async function main() {
    const root = await fs.mkdtemp(
        path.join(os.tmpdir(), 'chatluna-scope-probe-')
    )
    const external = await fs.mkdtemp(
        path.join(os.tmpdir(), 'chatluna-external-probe-')
    )
    const scope = path.join(root, 'agent')
    const grader = path.join(root, 'grader')
    const dataset = path.join(root, 'dataset')
    const readOnly = path.join(root, 'readonly')
    const denied = path.join(scope, 'denied')
    const outsideFile = path.join(grader, 'secret.txt')
    const scopeFile = path.join(scope, 'inside.txt')
    const symlinkFile = path.join(scope, 'escape.txt')
    const symlinkDir = path.join(scope, 'escape-dir')
    const externalFile = path.join(external, 'secret.txt')
    const externalHeredocFile = path.join(external, 'heredoc.txt')
    const scriptFile = path.join(scope, 'script.cjs')
    const shebangFile = path.join(scope, 'script.js')
    const moduleFile = path.join(scope, 'module.cjs')
    const workspaceModule = path.join(process.cwd(), 'node_modules', 'undici')
    const checks = {}

    await Promise.all([
        fs.mkdir(path.join(scope, 'nested'), { recursive: true }),
        fs.mkdir(denied, { recursive: true }),
        fs.mkdir(grader, { recursive: true }),
        fs.mkdir(dataset, { recursive: true }),
        fs.mkdir(readOnly, { recursive: true })
    ])
    await Promise.all([
        fs.writeFile(scopeFile, 'inside\n'),
        fs.writeFile(path.join(denied, 'secret.txt'), 'denied\n'),
        fs.writeFile(outsideFile, 'outside-secret\n'),
        fs.writeFile(path.join(dataset, 'fixture.txt'), 'dataset\n'),
        fs.writeFile(path.join(readOnly, 'reference.txt'), 'reference\n'),
        fs.writeFile(externalFile, 'external-secret\n'),
        fs.writeFile(scriptFile, "process.stdout.write('script-ok\\n')\n"),
        fs.writeFile(
            shebangFile,
            "#!/usr/bin/env node\nprocess.stdout.write('shebang-ok\\n')\n"
        ),
        fs.writeFile(
            moduleFile,
            'process.stdout.write(`module-ok:${typeof require(process.argv[2]).fetch}\\n`)\n'
        )
    ])
    await fs.chmod(shebangFile, 0o755)
    await fs.symlink(outsideFile, symlinkFile)
    await fs.symlink(grader, symlinkDir)

    const configPath = path.join(root, 'data/chatluna/agents/config.json')
    await fs.mkdir(path.dirname(configPath), { recursive: true })
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
                        dangerouslySkipPermissions: false,
                        preferredShell: 'auto',
                        scopePath: scope,
                        readOnlyRoots: [readOnly],
                        denyRoots: [denied],
                        ignores: [],
                        allowedCommands: [],
                        blockedCommands: [],
                        commandTimeoutMs: 5000,
                        networkPolicy: 'block'
                    }
                }
            },
            null,
            4
        ) + '\n',
        'utf8'
    )

    const app = new Context()
    app.baseDir = root
    const forks = []
    let session

    try {
        forks.push(app.plugin(memory))
        forks.push(app.plugin(server, { host: '127.0.0.1', port: 0 }))
        forks.push(app.plugin(NodeConsole, { open: false }))
        forks.push(
            app.plugin(chatluna, {
                defaultModel: '无',
                defaultEmbeddings: '无'
            })
        )
        forks.push(app.plugin(agent))
        await app.start()

        const realScope = await fs.realpath(scope)

        session = await app.chatluna_agent.computer.getOrCreateSession({
            backend: 'local',
            conversationId: 'scope-probe'
        })
        assert.equal(session.getScopePath(), realScope)
        assert(session.isInScope(scopeFile))
        assert(!session.isInScope(outsideFile))
        assert(!session.isInScope(symlinkFile))

        const temp = await session.getTempDir()
        assert(temp.startsWith(os.tmpdir()))
        assert.notEqual(temp, os.tmpdir())
        await session.writeFile(path.join(temp, 'private.txt'), 'private\n')
        assert(
            (await session.readFile(path.join(temp, 'private.txt'))).includes(
                'private'
            )
        )

        assert((await session.readFile(scopeFile)).includes('inside'))
        await session.writeFile(path.join(scope, 'nested', 'new.txt'), 'new\n')
        const edit = await session.editFile(scopeFile, 'inside', 'scope', 1)
        assert.equal(edit.success, true)
        assert((await session.readFile(scope)).includes('nested/'))

        assert(
            (
                await session.readFile(path.join(readOnly, 'reference.txt'))
            ).includes('reference')
        )
        await assert.rejects(
            () => session.writeFile(path.join(readOnly, 'blocked.txt'), 'x'),
            /read-only|outside/
        )
        await assert.rejects(
            () => session.readFile(path.join(denied, 'secret.txt')),
            /denied/
        )
        await assert.rejects(
            () =>
                session.readFile(
                    path.join(scope, '..', 'grader', 'secret.txt')
                ),
            /outside/
        )
        await assert.rejects(() => session.readFile(outsideFile), /outside/)
        await assert.rejects(
            () => session.writeFile(path.join(grader, 'new.txt'), 'x'),
            /outside/
        )
        await assert.rejects(
            () => session.editFile(outsideFile, 'outside', 'changed'),
            /outside/
        )
        await assert.rejects(() => session.readFile(symlinkFile), /outside/)
        await assert.rejects(
            () => session.writeFile(path.join(symlinkDir, 'new.txt'), 'x'),
            /outside/
        )
        await assert.rejects(() => session.glob('**/*', symlinkDir), /outside/)
        await assert.rejects(
            () => session.grep('outside', symlinkDir),
            /outside/
        )
        await assert.rejects(() => session.glob('*', grader), /outside/)
        await assert.rejects(() => session.grep('outside', grader), /outside/)

        const glob = await session.glob('**/*.txt')
        const globText = Array.isArray(glob) ? glob.join('\n') : glob.text
        assert(globText.includes('inside.txt'))
        assert(!globText.includes('grader'))
        assert(!globText.includes('outside-secret'))
        const grep = await session.grep('outside-secret')
        const grepText = Array.isArray(grep) ? grep.join('\n') : grep.text
        assert(!grepText.includes('outside-secret'))

        if (process.platform === 'darwin') {
            const pwd = await session.execute('pwd')
            assert.equal(pwd.exitCode, 0)
            assert.equal(pwd.stdout.trim(), realScope)
            assert.equal(pwd.stderr, '')
            checks.pwd = pwd.stdout.trim()

            const nodeEval = await session.execute(
                'node -e "process.stdout.write(\'eval-ok\\\\n\')"'
            )
            assert.equal(nodeEval.exitCode, 0)
            assert.equal(nodeEval.stdout, 'eval-ok\n')
            assert.equal(nodeEval.stderr, '')
            checks.nodeEval = nodeEval.stdout.trim()

            const nodeScript = await session.execute('node script.cjs')
            assert.equal(nodeScript.exitCode, 0)
            assert.equal(nodeScript.stdout, 'script-ok\n')
            assert.equal(nodeScript.stderr, '')
            checks.nodeScript = nodeScript.stdout.trim()

            const shebang = await session.execute('./script.js')
            assert.equal(shebang.exitCode, 0)
            assert.equal(shebang.stdout, 'shebang-ok\n')
            assert.equal(shebang.stderr, '')
            checks.shebang = shebang.stdout.trim()

            const nodeModule = await session.execute(
                `node module.cjs '${workspaceModule}'`
            )
            assert.equal(nodeModule.exitCode, 0)
            assert.equal(nodeModule.stdout, 'module-ok:function\n')
            assert.equal(nodeModule.stderr, '')
            checks.workspaceModule = nodeModule.stdout.trim()

            const npx = await session.execute(
                `npx --no-install --prefix '${process.cwd()}' esbuild --version`
            )
            assert.equal(npx.exitCode, 0)
            assert.match(npx.stdout.trim(), /^\d+\.\d+\.\d+$/)
            assert.equal(npx.stderr, '')
            checks.npxWorkspace = npx.stdout.trim()

            const write = await session.execute('printf runtime > runtime.txt')
            assert.equal(write.exitCode, 0)
            assert(
                (
                    await session.readFile(path.join(scope, 'runtime.txt'))
                ).includes('runtime')
            )

            const workspaceHeredoc = await session.execute(
                "cat <<'EOF' > heredoc-workspace.txt\nworkspace-heredoc\nEOF"
            )
            assert.equal(workspaceHeredoc.exitCode, 0)
            assert.equal(workspaceHeredoc.stderr, '')
            assert.equal(
                await fs.readFile(
                    path.join(scope, 'heredoc-workspace.txt'),
                    'utf8'
                ),
                'workspace-heredoc\n'
            )
            checks.workspaceHeredoc = true

            const tmpHeredoc = await session.execute(
                'cat <<\'EOF\' > "$TMPDIR/heredoc-tmp.txt"\n' +
                    'tmp-heredoc\nEOF'
            )
            assert.equal(tmpHeredoc.exitCode, 0)
            assert.equal(tmpHeredoc.stderr, '')
            assert.equal(
                await fs.readFile(path.join(temp, 'heredoc-tmp.txt'), 'utf8'),
                'tmp-heredoc\n'
            )
            checks.tmpHeredoc = true

            const externalHeredoc = await session.execute(
                `cat <<'EOF' > '${externalHeredocFile}'\nblocked\nEOF`
            )
            assert.notEqual(externalHeredoc.exitCode, 0)
            await assert.rejects(() => fs.access(externalHeredocFile))
            checks.externalTmpWriteBlocked = externalHeredoc.exitCode

            const catOutside = await session.execute(`cat '${outsideFile}'`)
            assert.notEqual(catOutside.exitCode, 0)
            assert(!catOutside.stdout.includes('outside-secret'))
            checks.graderBlocked = catOutside.exitCode
            const catDataset = await session.execute(
                `cat '${path.join(dataset, 'fixture.txt')}'`
            )
            assert.notEqual(catDataset.exitCode, 0)
            assert(!catDataset.stdout.includes('dataset'))
            checks.datasetBlocked = catDataset.exitCode
            const catExternal = await session.execute(`cat '${externalFile}'`)
            assert.notEqual(catExternal.exitCode, 0)
            assert(!catExternal.stdout.includes('external-secret'))
            checks.externalTmpBlocked = catExternal.exitCode
            const catSymlink = await session.execute(`cat '${symlinkFile}'`)
            assert.notEqual(catSymlink.exitCode, 0)
            assert(!catSymlink.stdout.includes('outside-secret'))
            checks.symlinkBlocked = catSymlink.exitCode
            const catDenied = await session.execute(
                `cat '${path.join(denied, 'secret.txt')}'`
            )
            assert.notEqual(catDenied.exitCode, 0)
            assert(!catDenied.stdout.includes('denied'))
            const writeReadOnly = await session.execute(
                `printf changed > '${path.join(readOnly, 'reference.txt')}'`
            )
            assert.notEqual(writeReadOnly.exitCode, 0)
            assert.equal(
                await fs.readFile(path.join(readOnly, 'reference.txt'), 'utf8'),
                'reference\n'
            )

            await assert.rejects(
                () => session.execute('pwd', { workdir: grader }),
                /outside/
            )
            await assert.rejects(
                () =>
                    session.execute('pwd', {
                        workdir: `${scope}/nested/../../grader`
                    }),
                /outside/
            )
            await assert.rejects(
                () => session.execute('pwd', { workdir: symlinkDir }),
                /outside/
            )
            checks.cwdEscapeBlocked = true
            await assert.rejects(
                () =>
                    session.prepareBackgroundCommand('pwd', 'marker', {
                        workdir: grader
                    }),
                /outside/
            )
            await assert.rejects(
                () => session.createTerminal({ cwd: grader }),
                /outside/
            )

            const terminal = await session.createTerminal({ cwd: scope })
            let terminalOutput = ''
            const off = await terminal.onData((data) => {
                terminalOutput += data
            })
            await terminal.sendInput(
                `cat '${outsideFile}'\n` +
                    "cat <<'EOF' > terminal-heredoc.txt\n" +
                    'terminal-workspace\nEOF\n' +
                    "cat <<'EOF' > \"$TMPDIR/terminal-heredoc.txt\"\n" +
                    'terminal-tmp\nEOF\n' +
                    `cat <<'EOF' > '${externalHeredocFile}'\n` +
                    'blocked\nEOF\n'
            )
            await new Promise((resolve) => setTimeout(resolve, 700))
            off()
            await terminal.kill()
            assert(!terminalOutput.includes('outside-secret'))
            assert.equal(
                await fs.readFile(
                    path.join(scope, 'terminal-heredoc.txt'),
                    'utf8'
                ),
                'terminal-workspace\n'
            )
            assert.equal(
                await fs.readFile(
                    path.join(temp, 'terminal-heredoc.txt'),
                    'utf8'
                ),
                'terminal-tmp\n'
            )
            await assert.rejects(() => fs.access(externalHeredocFile))
            checks.terminalHeredoc = true

            const marker = '__CHATLUNA_SCOPE_PROBE__'
            const background = await session.prepareBackgroundCommand(
                `cat '${outsideFile}'`,
                marker
            )
            const backgroundTerminal = await session.createTerminal({
                cwd: scope
            })
            let backgroundOutput = ''
            const offBackground = await backgroundTerminal.onData((data) => {
                backgroundOutput += data
            })
            await backgroundTerminal.sendInput(background)
            await new Promise((resolve) => setTimeout(resolve, 700))
            offBackground()
            await backgroundTerminal.kill()
            assert(!backgroundOutput.includes('outside-secret'))

            const networkServer = createServer((socket) =>
                socket.end('connected')
            )
            await new Promise((resolve, reject) => {
                networkServer.once('error', reject)
                networkServer.listen(0, '127.0.0.1', resolve)
            })
            try {
                const port = networkServer.address().port
                const network = await session.execute(
                    `node -e 'const net=require("net");const s=net.createConnection(${port},"127.0.0.1",()=>process.exit(0));s.on("error",()=>process.exit(1));setTimeout(()=>process.exit(2),1000)'`
                )
                assert.notEqual(network.exitCode, 0)
                checks.networkBlocked = network.exitCode
            } finally {
                await new Promise((resolve) => networkServer.close(resolve))
            }
        }

        if (process.platform !== 'win32') {
            const pidFile = path.join(scope, 'foreground.pid')
            const running = session.execute(
                `node -e "require('fs').writeFileSync('${pidFile}',String(process.pid));setInterval(()=>{},1000)"`,
                { timeout: 60000 }
            )
            await new Promise((resolve) => setTimeout(resolve, 700))
            const pid = Number((await fs.readFile(pidFile, 'utf8')).trim())
            const pgid = Number(
                execFileSync(
                    'ps',
                    ['-o', 'pgid=', '-p', String(pid)],
                    { encoding: 'utf8' }
                ).trim()
            )
            assert(Number.isInteger(pgid) && pgid > 0)
            assert.doesNotThrow(() => process.kill(-pgid, 0))

            await session.disconnect()
            const stopped = await running
            assert.notEqual(stopped.exitCode, 0)
            assert.throws(() => process.kill(-pgid, 0), { code: 'ESRCH' })
            checks.disconnectKilledForegroundGroup = pgid
        } else {
            await session.disconnect()
        }
        const skip = await app.chatluna_agent.computer.getOrCreateSession({
            backend: 'local',
            conversationId: 'scope-probe-skip'
        })
        app.chatluna_agent.computer.config.computer.local.dangerouslySkipPermissions = true
        try {
            assert(
                (await skip.readFile(outsideFile)).includes('outside-secret')
            )
            await skip.writeFile(path.join(grader, 'escape.txt'), 'escape\n')
            const escaped = await skip.execute(`cat '${outsideFile}'`, {
                workdir: grader
            })
            assert.equal(escaped.exitCode, 0)
            assert(escaped.stdout.includes('outside-secret'))
            checks.dangerousSkip = escaped.stdout.trim()
        } finally {
            app.chatluna_agent.computer.config.computer.local.dangerouslySkipPermissions = false
            await skip.disconnect()
        }

        process.stdout.write(
            JSON.stringify({
                probe: 'local-scope',
                platform: process.platform,
                sandbox:
                    process.platform === 'darwin' ? 'sandbox-exec' : 'api-only',
                checks
            }) + '\n'
        )
    } finally {
        if (session?.isConnected()) await session.disconnect()
        for (const fork of forks.reverse()) fork.dispose()
        await app.lifecycle.flush()
        await app.stop()
        await Promise.all([
            fs.rm(root, { recursive: true, force: true }),
            fs.rm(external, { recursive: true, force: true })
        ])
    }
}

main().catch((err) => {
    process.stderr.write(`${err.stack || err.message || String(err)}\n`)
    process.exitCode = 1
})

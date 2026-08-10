const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

async function main() {
    const root = await fs.mkdtemp(
        path.join(os.tmpdir(), 'chatluna-noop-file-writes-')
    )
    const file = path.join(root, 'same.txt')
    await fs.writeFile(file, 'same\n')

    const bundle = path.join(
        process.cwd(),
        'packages/extension-agent/lib/index.cjs'
    )
    const source = await fs.readFile(bundle, 'utf8')
    const mod = { exports: {} }
    new Function(
        'require',
        'module',
        'exports',
        '__filename',
        '__dirname',
        `${source}
module.exports.__noopProbe = { FileStore, OpenTerminalComputerSession, E2BComputerSession }`
    )(
        require,
        mod,
        mod.exports,
        bundle,
        path.dirname(bundle)
    )
    const {
        FileStore,
        OpenTerminalComputerSession,
        E2BComputerSession
    } = mod.exports.__noopProbe

    const originalMkdir = fs.mkdir
    const originalWriteFile = fs.writeFile
    let mkdirCalls = 0
    let writeFileCalls = 0
    fs.mkdir = new Proxy(originalMkdir, {
        apply(target, thisArg, args) {
            mkdirCalls += 1
            return Reflect.apply(target, thisArg, args)
        }
    })
    fs.writeFile = new Proxy(originalWriteFile, {
        apply(target, thisArg, args) {
            writeFileCalls += 1
            return Reflect.apply(target, thisArg, args)
        }
    })

    try {
        const cfg = {
            enabled: true,
            sandboxMode: 'workspace-write',
            approvalMode: 'never',
            dangerouslySkipPermissions: true,
            preferredShell: 'auto',
            scopePath: root,
            readOnlyRoots: [],
            denyRoots: [],
            ignores: [],
            allowedCommands: [],
            blockedCommands: [],
            commandTimeoutMs: 5000,
            networkPolicy: 'block'
        }
        const store = new FileStore(cfg, root)
        const mtimeBefore = (await fs.stat(file)).mtimeNs
        const write = await store.writeFile(file, 'same\n')
        const mtimeAfterWrite = (await fs.stat(file)).mtimeNs
        assert.deepEqual(write, {
            type: 'text',
            before: 'same\n',
            after: 'same\n'
        })
        assert.equal(mtimeAfterWrite, mtimeBefore)
        assert.equal(mkdirCalls, 0)
        assert.equal(writeFileCalls, 0)

        const edit = await store.editFile(file, 'same', 'same', 1)
        const mtimeAfterEdit = (await fs.stat(file)).mtimeNs
        assert.deepEqual(edit, {
            success: true,
            before: 'same\n',
            after: 'same\n',
            replacements: 1
        })
        assert.equal(mtimeAfterEdit, mtimeBefore)
        assert.equal(mkdirCalls, 0)
        assert.equal(writeFileCalls, 0)

        let openPosts = 0
        const openCtx = {
            http: Object.assign(async () => undefined, {
                post: async () => {
                    openPosts += 1
                }
            })
        }
        const open = new OpenTerminalComputerSession(
            openCtx,
            {
                enabled: true,
                baseUrl: 'http://open-terminal-probe',
                apiKey: 'probe',
                deploymentMode: 'unknown',
                userIsolation: false
            },
            { cwd: '/' },
            'open-terminal-probe'
        )
        open.readFile = async () => 'same'
        const openEdit = await open.editFile('same.txt', 'same', 'same', 1)
        assert.deepEqual(openEdit, {
            success: true,
            before: 'same',
            after: 'same',
            replacements: 1
        })
        assert.equal(openPosts, 0)

        let e2bWrites = 0
        const e2b = new E2BComputerSession(
            {},
            {
                enabled: true,
                apiKey: 'probe',
                template: 'probe',
                desktopTemplate: 'probe',
                timeoutMs: 5000,
                keepAlive: false
            },
            { cwd: '/' },
            'e2b-probe'
        )
        e2b.readFile = async () => 'same'
        e2b.writeFile = async () => {
            e2bWrites += 1
            return { type: 'text', before: 'same', after: 'same' }
        }
        const e2bEdit = await e2b.editFile('same.txt', 'same', 'same', 1)
        assert.deepEqual(e2bEdit, {
            success: true,
            before: 'same',
            after: 'same',
            replacements: 1
        })
        assert.equal(e2bWrites, 0)

        process.stdout.write(
            JSON.stringify({
                probe: 'noop-file-writes',
                local: {
                    mtimeUnchanged: true,
                    mkdirCalls,
                    writeFileCalls
                },
                openTerminal: { replacePosts: openPosts },
                e2b: { writeCalls: e2bWrites }
            }) + '\n'
        )
    } finally {
        fs.mkdir = originalMkdir
        fs.writeFile = originalWriteFile
        await fs.rm(root, { recursive: true, force: true })
    }
}

main().catch((err) => {
    process.stderr.write(`${err.stack || err.message || String(err)}\n`)
    process.exitCode = 1
})

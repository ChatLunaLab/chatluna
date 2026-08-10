const assert = require('assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')

const { Context } = require('koishi')
const memory = require('@koishijs/plugin-database-memory').default
const server = require('@koishijs/plugin-server').default
const NodeConsole = require('@koishijs/plugin-console').default
const chatluna = require('koishi-plugin-chatluna')
const agent = require('koishi-plugin-chatluna-agent')

async function invoke(tool, args, id, cfg) {
    const msg = await tool.invoke(
        {
            name: tool.name,
            args,
            id,
            type: 'tool_call'
        },
        cfg
    )
    assert.equal(msg.getType(), 'tool')
    assert.equal(msg.tool_call_id, id)
    assert.equal(typeof msg.content, 'string')
    return msg.content
}

async function main() {
    const root = await fs.mkdtemp(
        path.join(os.tmpdir(), 'chatluna-tool-observation-')
    )
    const config = path.join(root, 'data/chatluna/agents/config.json')
    const app = new Context()
    const forks = []
    app.baseDir = root

    await fs.mkdir(path.dirname(config), { recursive: true })
    await fs.writeFile(
        config,
        JSON.stringify(
            {
                version: 4,
                computer: {
                    defaultProvider: 'local',
                    local: {
                        enabled: true,
                        approvalMode: 'never',
                        scopePath: root
                    }
                }
            },
            null,
            4
        ) + '\n'
    )

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

        const write = app.chatluna.platform
            .getTool('file_write')
            .createTool({})
        const edit = app.chatluna.platform
            .getTool('file_edit')
            .createTool({})
        const bash = app.chatluna.platform.getTool('bash').createTool({})
        const cfg = {
            configurable: {
                agentContext: {
                    kind: 'main',
                    agentId: 'main',
                    agentName: 'main',
                    conversationId: 'tool-observation-probe',
                    requestId: 'tool-observation-probe',
                    source: 'chatluna'
                }
            }
        }

        const overwriteFile = path.join(root, 'overwrite.ts')
        await fs.writeFile(
            overwriteFile,
            'export function legacy(value: string): string {\n' +
                '    return value\n' +
                '}\n'
        )
        const overwrite = await invoke(
            write,
            {
                filePath: overwriteFile,
                content:
                    'export function current(value: number): number {\n' +
                    '    return value\n' +
                    '}\n'
            },
            'write-overwrite',
            cfg
        )
        const oldExport =
            '-export function legacy(value: string): string {'
        const newExport =
            '+export function current(value: number): number {'
        assert(overwrite.includes(oldExport))
        assert(overwrite.includes(newExport))

        const editFile = path.join(root, 'edit.ts')
        await fs.writeFile(
            editFile,
            'export class Worker {\n' +
                '    get value(): string {\n' +
                "        return 'legacy'\n" +
                '    }\n' +
                '}\n'
        )
        const edited = await invoke(
            edit,
            {
                filePath: editFile,
                oldString:
                    '    get value(): string {\n' +
                    "        return 'legacy'\n" +
                    '    }',
                newString:
                    '    get value(limit: number): number {\n' +
                    '        return limit\n' +
                    '    }'
            },
            'edit-multiline',
            cfg
        )
        const oldGetter = '-    get value(): string {'
        const newGetter = '+    get value(limit: number): number {'
        assert(edited.includes(oldGetter))
        assert(edited.includes(newGetter))

        const createdFile = path.join(root, 'created.ts')
        const created = await invoke(
            write,
            {
                filePath: createdFile,
                content:
                    'export function created(name: string): string {\n' +
                    '    return name\n' +
                    '}\n'
            },
            'write-create',
            cfg
        )
        assert(created.includes('@@ -0,0 +1,3 @@'))
        assert(
            created.includes(
                '+export function created(name: string): string {'
            )
        )

        const noChanges = await invoke(
            write,
            {
                filePath: createdFile,
                content:
                    'export function created(name: string): string {\n' +
                    '    return name\n' +
                    '}\n'
            },
            'write-no-changes',
            cfg
        )
        assert(noChanges.includes('No changes.'))
        assert(!noChanges.includes('Wrote'))

        const largeFile = path.join(root, 'large.ts')
        await fs.writeFile(
            largeFile,
            Array.from(
                { length: 100 },
                (_, idx) => `export const old${idx} = ${idx}`
            ).join('\n') + '\n'
        )
        const large = await invoke(
            write,
            {
                filePath: largeFile,
                content:
                    Array.from(
                        { length: 100 },
                        (_, idx) => `export const next${idx} = ${idx + 1}`
                    ).join('\n') + '\n'
            },
            'write-large',
            cfg
        )
        const diffStart = large.indexOf('Diff:\n') + 'Diff:\n'.length
        const diffEnd = large.indexOf('\n\nWrote ', diffStart)
        assert(diffStart >= 'Diff:\n'.length)
        assert(diffEnd > diffStart)
        const hunk = large.slice(diffStart, diffEnd)
        assert(hunk.split('\n').length <= 40)
        assert(hunk.length <= 2000)
        assert(hunk.includes('[diff truncated]'))

        const wideFile = path.join(root, 'wide.ts')
        await fs.writeFile(wideFile, `export const old = '${'a'.repeat(3000)}'\n`)
        const wide = await invoke(
            write,
            {
                filePath: wideFile,
                content: `export const next = '${'b'.repeat(3000)}'\n`
            },
            'write-wide',
            cfg
        )
        const wideStart = wide.indexOf('Diff:\n') + 'Diff:\n'.length
        const wideEnd = wide.indexOf('\n\nWrote ', wideStart)
        assert(wideStart >= 'Diff:\n'.length)
        assert(wideEnd > wideStart)
        const wideHunk = wide.slice(wideStart, wideEnd)
        assert(wideHunk.split('\n').length <= 40)
        assert(wideHunk.length <= 2000)
        assert(wideHunk.includes('[diff truncated]'))

        const success = await invoke(
            bash,
            {
                command: `node -e "process.stdout.write('tool-success')"`
            },
            'bash-success',
            cfg
        )
        assert(success.includes('Exit code: 0'))
        const failed = await invoke(
            bash,
            {
                command:
                    `node -e "process.stderr.write('tool-failure');` +
                    'process.exit(7)"'
            },
            'bash-failed',
            cfg
        )
        assert(failed.includes('Exit code: 7'))

        process.stdout.write(
            JSON.stringify({
                probe: 'tool-observation',
                checks: {
                    writeOverwrite: [oldExport, newExport],
                    editMultiline: [oldGetter, newGetter],
                    newFile: '@@ -0,0 +1,3 @@',
                    noChanges: 'No changes without Wrote',
                    largeDiff: {
                        lines: hunk.split('\n').length,
                        chars: hunk.length,
                        truncated: true
                    },
                    wideDiff: {
                        lines: wideHunk.split('\n').length,
                        chars: wideHunk.length,
                        truncated: true
                    },
                    bashSuccess: 'Exit code: 0',
                    bashNonzero: 'Exit code: 7'
                }
            }) + '\n'
        )
    } finally {
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

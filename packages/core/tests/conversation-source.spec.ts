/// <reference types="mocha" />

import fs from 'node:fs/promises'
import path from 'node:path'
import { assert } from 'chai'
import { expectRejected } from './helpers'

it('conversation-first runtime removes legacy room entry points from active source tree', async () => {
    const coreSrc = path.resolve(__dirname, '../src')

    await Promise.all([
        expectRejected(fs.access(path.join(coreSrc, 'chains', 'rooms.ts'))),
        expectRejected(fs.access(path.join(coreSrc, 'commands', 'room.ts'))),
        expectRejected(fs.access(path.join(coreSrc, 'middlewares', 'room'))),
        expectRejected(
            fs.access(
                path.join(coreSrc, 'middlewares', 'model', 'request_model.ts')
            )
        ),
        expectRejected(fs.access(path.join(coreSrc, 'legacy', 'types.ts')))
    ])
})

it('conversation cleanup listeners in downstream packages use conversation lifecycle events', async () => {
    const files = [
        path.resolve(
            __dirname,
            '../../extension-long-memory/src/service/memory.ts'
        ),
        path.resolve(__dirname, '../../extension-agent/src/service/skills.ts'),
        path.resolve(__dirname, '../../extension-tools/src/plugins/todos.ts')
    ]

    for (const file of files) {
        const content = await fs.readFile(file, 'utf8')
        assert.equal(content.includes('chatluna/clear-chat-history'), false)
        assert.equal(
            content.includes('chatluna/after-conversation-clear-history'),
            true
        )
    }
})

it('wipe source keeps legacy migration and runtime table cleanup wired in', async () => {
    const source = await fs.readFile(
        path.resolve(__dirname, '../src/middlewares/system/wipe.ts'),
        'utf8'
    )

    assert.match(source, /LEGACY_MIGRATION_TABLES/)
    assert.match(source, /LEGACY_RUNTIME_TABLES/)
    assert.match(source, /for \(const table of LEGACY_MIGRATION_TABLES\)/)
    assert.match(source, /for \(const table of LEGACY_RUNTIME_TABLES\)/)
})

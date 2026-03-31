/// <reference types="mocha" />

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assert } from 'chai'
import { createMemoryService, createSession } from './helpers'

it('ConversationService supports sampled end-to-end lifecycle flow', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatluna-e2e-flow-'))
    const { app, database, service } = await createMemoryService({
        baseDir: dir
    })

    try {
        const session = createSession()
        const created = await service.ensureActiveConversation(session, {
            presetLane: 'helper'
        })
        const listed = await service.listConversations(session, {
            presetLane: 'helper'
        })
        const renamed = await service.renameConversation(session, {
            conversationId: created.conversation.id,
            presetLane: 'helper',
            title: 'Helper Session'
        })
        const exported = await service.exportConversation(session, {
            conversationId: created.conversation.id,
            presetLane: 'helper'
        })
        const archived = await service.archiveConversation(session, {
            conversationId: created.conversation.id,
            presetLane: 'helper'
        })
        const restored = await service.restoreConversation(session, {
            conversationId: created.conversation.id,
            presetLane: 'helper'
        })
        const removed = await service.deleteConversation(session, {
            conversationId: created.conversation.id,
            presetLane: 'helper'
        })
        const stored = await database.get('chatluna_conversation', {
            id: created.conversation.id
        })

        assert.equal(listed.length, 1)
        assert.equal(renamed.title, 'Helper Session')
        assert.equal(path.extname(exported.path), '.md')
        assert.equal(archived.conversation.status, 'archived')
        assert.equal(restored.status, 'active')
        assert.equal(removed.status, 'deleted')
        assert.equal(stored[0].status, 'deleted')
    } finally {
        await app.stop()
    }
})

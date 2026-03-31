/// <reference types="mocha" />

import { assert } from 'chai'
import { Pagination } from '../src/utils/pagination'
import {
    bufferToArrayBuffer,
    gzipDecode,
    gzipEncode
} from '../src/utils/compression'
import {
    getMessageContent,
    parsePresetLaneInput
} from '../src/utils/message_content'
import {
    applyPresetLane,
    computeBaseBindingKey
} from '../src/services/conversation_types'
import {
    createMessage,
    type BindingSessionShape,
    FakeDatabase
} from './helpers'

it('computeBaseBindingKey builds personal direct bindings', () => {
    const bindingKey = computeBaseBindingKey(
        {
            platform: 'discord',
            selfId: 'bot',
            guildId: 'guild',
            userId: 'user',
            isDirect: true
        } as BindingSessionShape as never,
        'personal'
    )

    assert.equal(bindingKey, 'personal:discord:bot:direct:user')
})

it('computeBaseBindingKey builds shared guild bindings', () => {
    const bindingKey = computeBaseBindingKey(
        {
            platform: 'discord',
            selfId: 'bot',
            guildId: 'guild',
            userId: 'user',
            isDirect: false
        } as BindingSessionShape as never,
        'shared'
    )

    assert.equal(bindingKey, 'shared:discord:bot:guild')
})

it('applyPresetLane appends preset lane when provided', () => {
    assert.equal(
        applyPresetLane('personal:discord:bot:guild:user', 'helper'),
        'personal:discord:bot:guild:user:preset:helper'
    )
    assert.equal(
        applyPresetLane('personal:discord:bot:guild:user', undefined),
        'personal:discord:bot:guild:user'
    )
})

it('parsePresetLaneInput normalizes alias prefixes and bare queries', () => {
    assert.deepEqual(
        parsePresetLaneInput('Sydney: hello', ['sydney', 'helper']),
        {
            preset: 'sydney',
            content: 'hello',
            queryOnly: false
        }
    )
    assert.deepEqual(parsePresetLaneInput('helper，', ['sydney', 'helper']), {
        preset: 'helper',
        content: '',
        queryOnly: true
    })
    assert.equal(parsePresetLaneInput('plain message', ['sydney']), null)
})

it('pagination normalizes page and limit bounds', async () => {
    const pagination = new Pagination<number>({
        page: 1,
        limit: 2,
        formatItem: (item) => `item:${item}`,
        formatString: {
            top: 'top',
            bottom: 'bottom',
            pages: 'page [page]/[total]'
        }
    })

    await pagination.push([1, 2, 3], 'numbers')

    assert.deepEqual(await pagination.getPage(0, 0, 'numbers'), [1])
    assert.equal(
        await pagination.getFormattedPage(2, 2, 'numbers'),
        'top\nitem:3\nbottom\npage 2/2'
    )
})

it('FakeDatabase.get applies sort and pagination modifiers', async () => {
    const database = new FakeDatabase()
    database.tables.chatluna_message = [
        createMessage({
            id: 'message-a',
            createdAt: new Date('2026-03-21T00:00:03.000Z')
        }),
        createMessage({
            id: 'message-b',
            createdAt: new Date('2026-03-21T00:00:01.000Z')
        }),
        createMessage({
            id: 'message-c',
            createdAt: new Date('2026-03-21T00:00:02.000Z')
        })
    ]

    const rows = await database.get(
        'chatluna_message',
        {},
        {
            sort: {
                createdAt: 'asc'
            },
            offset: 1,
            limit: 1
        }
    )

    assert.deepEqual(
        rows.map((row) => row.id),
        ['message-c']
    )
})

it('gzip helpers round-trip archived payload content', async () => {
    const json = JSON.stringify({ text: 'hello', values: [1, 2, 3] })
    const compressed = await gzipEncode(json)
    const base64 = await gzipEncode(json, 'base64')
    const arrayBuffer = bufferToArrayBuffer(compressed)

    assert.equal(await gzipDecode(arrayBuffer), json)
    assert.equal(await gzipDecode(base64), json)
})

it('getMessageContent flattens structured text parts', () => {
    assert.equal(
        getMessageContent([
            { type: 'text', text: 'hello ' },
            { type: 'image_url', image_url: 'https://example.com/x.png' },
            { type: 'text', text: 'world' }
        ] as never),
        'hello world'
    )
})

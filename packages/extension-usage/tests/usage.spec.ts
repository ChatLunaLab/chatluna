/// <reference types="mocha" />

import { assert } from 'chai'
import { aggregateUsage, buildCleanupWhere, buildUsageWhere } from '../src'

it('aggregateUsage groups usage rows by source', () => {
    const rows = aggregateUsage([
        {
            source: 'chatluna',
            callType: 'llm',
            platform: 'openai',
            model: 'gpt',
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            estimated: false,
            createdAt: new Date()
        },
        {
            source: 'chatluna-livingmemory',
            callType: 'embeddings',
            platform: 'openai',
            model: 'embedding',
            inputTokens: 6,
            outputTokens: 0,
            totalTokens: 6,
            estimated: true,
            createdAt: new Date()
        },
        {
            source: 'chatluna-livingmemory',
            callType: 'reranker',
            platform: 'openai',
            model: 'reranker',
            inputTokens: 4,
            outputTokens: 0,
            totalTokens: 4,
            estimated: true,
            createdAt: new Date()
        }
    ])

    assert.equal(rows.length, 2)
    assert.include(rows[0], {
        source: 'chatluna',
        calls: 1,
        llmCalls: 1,
        totalTokens: 15,
        estimatedTokens: 0
    })
    assert.include(rows[1], {
        source: 'chatluna-livingmemory',
        calls: 2,
        embeddingsCalls: 1,
        rerankerCalls: 1,
        totalTokens: 10,
        estimatedTokens: 10
    })
    assert.equal(rows[1].estimatedRatio, 1)
})

it('aggregateUsage defaults to grouping rows by source', () => {
    const rows = aggregateUsage([
        {
            source: 'chatluna',
            callType: 'llm',
            platform: 'openai',
            model: 'gpt',
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            estimated: false,
            createdAt: new Date()
        },
        {
            source: 'chatluna-character',
            callType: 'llm',
            platform: 'openai',
            model: 'gpt',
            inputTokens: 8,
            outputTokens: 4,
            totalTokens: 12,
            estimated: false,
            createdAt: new Date()
        }
    ])

    assert.deepEqual(
        rows.map((row) => row.source),
        ['chatluna', 'chatluna-character']
    )
})

it('aggregateUsage groups usage rows by model', () => {
    const rows = aggregateUsage(
        [
            {
                source: 'chatluna',
                callType: 'llm',
                platform: 'openai',
                model: 'gpt',
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
                estimated: false,
                createdAt: new Date()
            },
            {
                source: 'chatluna-character',
                callType: 'embeddings',
                platform: 'openai',
                model: 'gpt',
                inputTokens: 6,
                outputTokens: 0,
                totalTokens: 6,
                estimated: true,
                createdAt: new Date()
            },
            {
                source: 'chatluna-livingmemory',
                callType: 'reranker',
                platform: 'cohere',
                model: 'rerank',
                inputTokens: 4,
                outputTokens: 0,
                totalTokens: 4,
                estimated: true,
                createdAt: new Date()
            }
        ],
        undefined,
        'model'
    )

    assert.equal(rows.length, 2)
    assert.include(rows[0], {
        source: 'openai/gpt',
        platform: 'openai',
        model: 'gpt',
        calls: 2,
        llmCalls: 1,
        embeddingsCalls: 1,
        totalTokens: 21,
        estimatedTokens: 6
    })
    assert.include(rows[1], {
        source: 'cohere/rerank',
        platform: 'cohere',
        model: 'rerank',
        calls: 1,
        rerankerCalls: 1,
        totalTokens: 4,
        estimatedTokens: 4
    })
})

it('aggregateUsage keeps same model names on different platforms separate', () => {
    const rows = aggregateUsage(
        [
            {
                source: 'chatluna',
                callType: 'llm',
                platform: 'openai',
                model: 'gpt',
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
                estimated: false,
                createdAt: new Date()
            },
            {
                source: 'chatluna-character',
                callType: 'llm',
                platform: 'azure-openai',
                model: 'gpt',
                inputTokens: 8,
                outputTokens: 4,
                totalTokens: 12,
                estimated: false,
                createdAt: new Date()
            }
        ],
        undefined,
        'model'
    )

    assert.deepEqual(
        rows.map((row) => row.source),
        ['openai/gpt', 'azure-openai/gpt']
    )
})

it('aggregateUsage total row ignores model grouping', () => {
    const rows = aggregateUsage(
        [
            {
                source: 'chatluna',
                callType: 'llm',
                platform: 'openai',
                model: 'gpt',
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
                estimated: false,
                createdAt: new Date()
            },
            {
                source: 'chatluna-character',
                callType: 'llm',
                platform: 'azure-openai',
                model: 'gpt',
                inputTokens: 8,
                outputTokens: 4,
                totalTokens: 12,
                estimated: false,
                createdAt: new Date()
            }
        ],
        'Total',
        'model'
    )

    assert.equal(rows.length, 1)
    assert.include(rows[0], {
        source: 'Total',
        calls: 2,
        totalTokens: 27
    })
    assert.isUndefined(rows[0].platform)
    assert.isUndefined(rows[0].model)
})

it('buildUsageWhere returns empty where without bounds', () => {
    assert.deepEqual(buildUsageWhere({}), {})
})

it('buildUsageWhere uses $gte only when only from is provided', () => {
    const from = '2026-05-01T00:00:00.000Z'
    const where = buildUsageWhere({ from })

    assert.deepEqual(where, { createdAt: { $gte: new Date(from) } })
})

it('buildUsageWhere uses $lte only when only to is provided', () => {
    const to = '2026-05-19T00:00:00.000Z'
    const where = buildUsageWhere({ to })

    assert.deepEqual(where, { createdAt: { $lte: new Date(to) } })
})

it('buildUsageWhere combines $gte and $lte when both bounds are provided', () => {
    const from = '2026-05-01T00:00:00.000Z'
    const to = '2026-05-19T00:00:00.000Z'
    const where = buildUsageWhere({ from, to })

    assert.deepEqual(where, {
        createdAt: { $gte: new Date(from), $lte: new Date(to) }
    })
})

it('buildCleanupWhere clears all records without bounds', () => {
    assert.deepEqual(buildCleanupWhere({ mode: 'all' }), {})
})

it('buildCleanupWhere clears records older than days', () => {
    const now = new Date('2026-05-20T12:00:00.000Z')

    assert.deepEqual(buildCleanupWhere({ mode: 'beforeDays', days: 7 }, now), {
        createdAt: { $lt: new Date('2026-05-13T12:00:00.000Z') }
    })
})

it('buildCleanupWhere rejects invalid days', () => {
    assert.throws(
        () => buildCleanupWhere({ mode: 'beforeDays', days: 0 }),
        /positive integer/
    )
    assert.throws(
        () => buildCleanupWhere({ mode: 'beforeDays', days: -1 }),
        /positive integer/
    )
    assert.throws(
        () => buildCleanupWhere({ mode: 'beforeDays', days: 1.5 }),
        /positive integer/
    )
    assert.throws(
        () => buildCleanupWhere({ mode: 'beforeDays', days: Number.NaN }),
        /positive integer/
    )
})

/// <reference types="mocha" />

import { assert } from 'chai'
import {
    ModelCapabilities,
    ModelType
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { GeminiClient } from '../src/client'
import { prepareModelConfig } from '../src/utils'

function client(cfg, raw = []) {
    let calls = 0
    const item = Object.create(GeminiClient.prototype)

    Object.assign(item, {
        _config: cfg,
        _requester: {
            getModels: async () => {
                calls++
                return raw
            }
        }
    })

    return {
        item,
        get calls() {
            return calls
        }
    }
}

it('GeminiClient expands additional Gemini models without pulling remote models', async () => {
    const cfg = {
        pullModels: false,
        imageModelSearch: false,
        additionalModels: [
            {
                model: 'gemini-2.5-pro',
                modelType: 'LLM 大语言模型',
                modelCapabilities: [ModelCapabilities.ToolCall],
                contextSize: 8192
            }
        ]
    }
    const mock = client(cfg)

    const models = await mock.item.refreshModels()

    assert.equal(mock.calls, 0)
    assert.deepEqual(
        models.map((model) => model.name),
        [
            'gemini-2.5-pro-non-thinking',
            'gemini-2.5-pro-thinking',
            'gemini-2.5-pro'
        ]
    )
    assert.equal(models[0].type, ModelType.llm)
    assert.equal(models[0].maxTokens, 8192)
})

it('GeminiClient keeps additional non-Gemini model names unchanged', async () => {
    const cfg = {
        pullModels: false,
        imageModelSearch: true,
        additionalModels: [
            {
                model: 'chatluna-chat-search',
                modelType: 'LLM 大语言模型',
                modelCapabilities: [
                    ModelCapabilities.TextInput,
                    ModelCapabilities.ToolCall
                ],
                contextSize: 4096
            }
        ]
    }
    const mock = client(cfg)

    const models = await mock.item.refreshModels()

    assert.deepEqual(models, [
        {
            name: 'chatluna-chat-search',
            type: ModelType.llm,
            capabilities: [
                ModelCapabilities.TextInput,
                ModelCapabilities.ToolCall
            ],
            maxTokens: 4096
        }
    ])
})

it('prepareModelConfig preserves configured non-Gemini request model names', () => {
    const cfg = {
        thinkingBudget: 77,
        imageGeneration: true,
        additionalModels: [
            {
                model: 'chatluna-chat-search',
                modelType: 'LLM 大语言模型',
                modelCapabilities: [
                    ModelCapabilities.TextInput,
                    ModelCapabilities.ToolCall
                ],
                contextSize: 4096
            }
        ]
    }

    const model = prepareModelConfig({ model: 'chatluna-chat-search' }, cfg)

    assert.equal(model.model, 'chatluna-chat-search')
    assert.equal(model.forceGoogleSearch, false)
    assert.equal(model.imageGeneration, true)
    assert.equal(model.thinkingBudget, 77)
})

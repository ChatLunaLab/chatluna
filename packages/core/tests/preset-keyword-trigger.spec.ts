/// <reference types="mocha" />

import { assert } from 'chai'
import { PresetService } from '../src/preset'
import { EMPTY_PRESET } from '../src/llm-core/prompt/preset_prompt_parse'
import { createConfig } from './helpers'

function createPresetService(config: Record<string, unknown> = {}) {
    const ctx = {
        scope: { isActive: true },
        on: () => {},
        schema: { set: () => {} }
    } as never
    return new PresetService(ctx, createConfig(config))
}

it('getKeywordTriggerAliases is empty when enablePresetKeywordTrigger is false', () => {
    const preset = new PresetService(
        {
            scope: { isActive: true },
            on: () => {},
            schema: { set: () => {} }
        } as never,
        createConfig({ enablePresetKeywordTrigger: false })
    )
    preset.addPreset({
        ...EMPTY_PRESET,
        triggerKeyword: ['catgirl', '猫娘'],
        config: {}
    })
    assert.deepEqual(preset.getKeywordTriggerAliases().value, [])
})

it('getKeywordTriggerAliases omits presets with config.enableKeywordTrigger false', () => {
    const preset = createPresetService({ enablePresetKeywordTrigger: true })
    preset.addPreset({
        ...EMPTY_PRESET,
        triggerKeyword: ['hidden'],
        config: { enableKeywordTrigger: false }
    })
    preset.addPreset({
        ...EMPTY_PRESET,
        triggerKeyword: ['visible'],
        config: {}
    })
    assert.deepEqual(preset.getKeywordTriggerAliases().value, ['visible'])
})
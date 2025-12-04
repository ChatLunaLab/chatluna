import { Context } from 'koishi'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import { Config } from './config'
import { ComputedRef } from '@vue/reactivity'
export declare class PresetService {
    private readonly ctx
    private readonly config
    private readonly _presets
    private _aborter
    private _lock
    constructor(ctx: Context, config: Config)
    loadPreset(file: string): Promise<void>
    private _loadPresetFromPath
    private _updatePreset
    private _removePreset
    loadAllPreset(): Promise<void>
    watchPreset(): void
    init(): Promise<void>
    getPreset(
        triggerKeyword: string,
        throwError?: boolean
    ): ComputedRef<PresetTemplate>

    getDefaultPreset(): ComputedRef<PresetTemplate>
    getAllPreset(concatKeyword?: boolean): ComputedRef<string[]>
    addPreset(preset: PresetTemplate): void
    private _updateSchema
    resetDefaultPreset(): Promise<void>
    resolvePresetDir(): string
    private _checkPresetDir
    private _copyDefaultPresets
}

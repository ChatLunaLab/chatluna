import { Context, Schema } from 'koishi';

import { createLogger } from './utils/logger';
import { Config } from './config';
import { Cache } from './cache';
import path from 'path';
import fs from 'fs/promises';
import { PresetTemplate, loadPreset } from './llm-core/prompt';


const logger = createLogger('@dingyi222666/chathub/preset')

export class Preset {

    private readonly _presets: PresetTemplate[] = []

    constructor(private readonly ctx: Context, private readonly config: Config,
        private readonly cache: Cache<"chathub/keys", string>) { }


    async loadAllPreset() {

        await this._checkPresetDir()

        const presetDir = this.resolvePresetDir()
        const files = await fs.readdir(presetDir)

        this._presets.length = 0

        for (const file of files) {
            // use file
            const extension = path.extname(file)
            if (extension !== '.txt' && extension !== '.yml') {
                continue
            }
            const rawText = await fs.readFile(path.join(presetDir, file), 'utf-8')
            const preset = loadPreset(rawText)
            preset.path = path.join(presetDir, file)
            this._presets.push(preset)
        }

        this.ctx.schema.set('preset', Schema.union(this._presets.map((preset) => Schema.const(preset.triggerKeyword[0]))))
    }

    async setDefaultPreset(triggerKeyword: string): Promise<void> {
        await this.cache.set('default-preset', triggerKeyword)
    }

    async getPreset(triggerKeyword: string, loadForDisk: boolean = true, throwError: boolean = true): Promise<PresetTemplate> {
        if (loadForDisk) {
            // always load for disk
            await this.loadAllPreset()
        }

        const preset = this._presets.find((preset) => preset.triggerKeyword.includes(triggerKeyword))

        if (preset) {
            return preset
        }

        if (throwError) {
            throw new Error(`No preset found for keyword ${triggerKeyword}`)
        }

        return null
    }

    async getDefaultPreset(): Promise<PresetTemplate> {
        if (this._presets.length === 0) {
            await this.loadAllPreset()
        }

        /*  const cached = await this.cache.get('default-preset')
         if (cached) {
             try {
                 return this.getPreset(cached)
             } catch {
                 logger.warn(`default preset ${cached} not found, reset default preset`)
             }
         } */

        const preset = this._presets.find((preset) => preset.triggerKeyword.includes('chatgpt'))


        if (preset) {
            // await this.cache.set('default-preset', 'chatgpt')
            return preset
        } else {
            await this._copyDefaultPresets()
            return this.getDefaultPreset()
        }

        // throw new Error("No default preset found")
    }

    async getAllPreset(): Promise<string[]> {
        await this.loadAllPreset()

        return this._presets.map((preset) => preset.triggerKeyword.join(', '))
    }

    async resetDefaultPreset(): Promise<void> {
        await this.cache.delete('default-preset')

        await this._copyDefaultPresets()
    }

    public resolvePresetDir() {
        return path.resolve(this.ctx.baseDir, "data/chathub/presets")
    }

    private async _checkPresetDir() {

        const presetDir = path.join(this.resolvePresetDir())

        // check if preset dir exists
        try {
            await fs.access(presetDir)
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                await fs.mkdir(presetDir, { recursive: true })
                await this._copyDefaultPresets()
            }
            else {
                throw err
            }
        }

    }

    private async _copyDefaultPresets() {
        const currentPresetDir = path.join(this.resolvePresetDir())

        const defaultPresetDir = path.join(__dirname, '../resources/presets')

        const files = await fs.readdir(defaultPresetDir)

        for (const file of files) {
            const filePath = path.join(defaultPresetDir, file)
            const fileStat = await fs.stat(filePath)
            if (fileStat.isFile()) {
                await fs.mkdir(currentPresetDir, { recursive: true })
                logger.debug(`copy preset file ${filePath} to ${currentPresetDir}`)
                await fs.copyFile(filePath, path.join(currentPresetDir, file))
            }
        }

    }

}

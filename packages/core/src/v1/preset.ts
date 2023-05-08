import { Context } from 'koishi';

import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';
import { Config } from '../config';
import { Cache } from './cache';
import path from 'path';
import fs from 'fs/promises';
import { PresetTemplate, loadPreset } from '@dingyi222666/chathub-llm-core/lib/prompt';


const logger = createLogger('@dingyi222666/chathub/preset')

export class Preset {

    private readonly presets: PresetTemplate[] = []

    constructor(private readonly ctx: Context, private readonly config: Config,
        private readonly cache: Cache<"chathub/keys", string>) { }


    async loadAllPreset() {

        await this.checkPresetDir()

        logger.debug(`preset: ${this.presets}`)

        const presetDir = this.resolvePresetDir()
        const files = await fs.readdir(this.resolvePresetDir())

        for (const file of files) {
            const rawText = await fs.readFile(path.join(presetDir, file), 'utf-8')
            const preset = loadPreset(rawText)
            this.presets.push(preset)
        }
    }

    async setDefaultPreset(triggerKeyword: string): Promise<void> {
        await this.cache.set('default-preset', triggerKeyword)
    }

    async getPreset(triggerKeyword: string): Promise<PresetTemplate> {

        if (this.presets.length === 0) {
            await this.loadAllPreset()
        }

        const preset = this.presets.find((preset) => preset.triggerKeyword.includes(triggerKeyword))
        if (preset) {
            return preset
        }

        throw new Error(`No preset found for keyword ${triggerKeyword}`)
    }

    async getDefaultPreset(): Promise<PresetTemplate> {
        if (this.presets.length === 0) {
            await this.loadAllPreset()
        }

        const key = 'default-preset'
        const cached = await this.cache.get(key)
        if (cached) {
            return this.getPreset(cached)
        }

        const preset = this.presets.find((preset) => preset.triggerKeyword.includes('猫娘'))
        if (preset) {
            await this.cache.set(key, '猫娘')
            return preset
        }

        throw new Error("No default preset found")
    }

    async getAllPreset(): Promise<string[]> {
        await this.loadAllPreset()

        return this.presets.map((preset) => preset.triggerKeyword.join(', '))
    }

    async resetDefaultPreset(): Promise<void> {
        await this.cache.delete('default-preset')

        await this.copyDefaultPresets()
    }

    private resolvePresetDir() {
        return path.join(this.config.configDir, "presets")
    }

    private async checkPresetDir() {

        const presetDir = path.join(this.resolvePresetDir())

        // check if preset dir exists
        try {
            await fs.access(presetDir)
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                await fs.mkdir(presetDir, { recursive: true })
                await this.copyDefaultPresets()
            }
            else {
                throw err
            }
        }

    }

    private async copyDefaultPresets() {
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

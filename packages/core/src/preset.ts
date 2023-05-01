import { Context } from 'koishi';
import { SimpleMessage } from './types';
import { createLogger } from './utils/logger';
import { Config } from './config';
import { Cache } from './cache';
import path from 'path';
import fs from 'fs/promises';


const logger = createLogger('@dingyi222666/chathub-copilothub-adapter/preset')

export class Preset {

    private readonly presets: PresetTemplate[] = []

    constructor(private readonly ctx: Context, private readonly config: Config,
        private readonly cache: Cache<"chathub/keys", string>) { }

    async loadAllPreset() {

        await this.checkPresetDir()

        const presetDir = path.join(process.cwd(), '/chathub/presets')

        const files = await fs.readdir(presetDir)

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

    async listAllPreset(): Promise<string[]> {
        if (this.presets.length === 0) {
            await this.loadAllPreset()
        }

        return this.presets.map((preset) => preset.triggerKeyword.join(','))
    }

    async resetDefaultPreset(): Promise<void> {
        await this.cache.delete('default-preset')

        await this.copyDefaultPresets()
    }

    private async checkPresetDir() {
        const presetDir = path.join(process.cwd(), '/chathub/presets')
        const presetDirStat = await fs.stat(presetDir)
        if (!presetDirStat.isDirectory()) {
            await fs.mkdir(presetDir)
            await this.copyDefaultPresets()
        }
    }

    private async copyDefaultPresets() {
        const currentPresetDir = path.join(process.cwd(), '/chathub/presets')

        const defaultPresetDir = path.join(__dirname, '../dist/presets')

        const files = await fs.readdir(defaultPresetDir)

        for (const file of files) {
            const filePath = path.join(defaultPresetDir, file)
            const fileStat = await fs.stat(filePath)
            if (fileStat.isFile()) {
                await fs.mkdir(currentPresetDir, { recursive: true })
                await fs.copyFile(filePath, path.join(currentPresetDir, file))
            }
        }

    }

}

export interface PresetMessage extends SimpleMessage { }

export class PresetTemplate {

    constructor(public readonly triggerKeyword: string[], public readonly messages: PresetMessage[]) { }


    format(inputVaraibles: Record<string, string>): SimpleMessage[] {
        return this.messages.map((message) => {
            return {
                content: this.formatString(message.content, inputVaraibles),
                role: message.role,
                sender: message.sender,
            }
        })
    }

    private formatString(rawString: string, inputVaraibles: Record<string, string>): string {
        return rawString.replace(/{(\w+)}/g, function (match, key) {
            return inputVaraibles[key] || match;
        });
    }
}

export function loadPreset(rawText: string): PresetTemplate {
    const triggerKeyword: string[] = []
    const messages: SimpleMessage[] = []

    // split like markdown paragraph
    // 傻逼CRLF
    const chunks = rawText
        .replace(/\r\n/g, '\n')
        .split(/\n\n/)


    const roleMappping = {
        "system": "system",
        "assistant": "model",
        "user": "user"
    }

    for (const chunk of chunks) {
        let [role, content] = chunk.split(':')
        role = role.trim().toLowerCase()


        if (role == "keyword") {
            triggerKeyword.push(...content.split(',').map((keyword) => keyword.trim()))
        } else {
            logger.debug(`role: ${role}, content: ${content}`)
            
            messages.push({
                role: roleMappping[role] as 'user' | 'system' | 'model',
                content: content.trim()
            })
        }
    }

    if (triggerKeyword.length == 0) {
        throw new Error("No trigger keyword found")
    }

    if (messages.length == 0) {
        throw new Error("No message found")
    }

    return new PresetTemplate(triggerKeyword, messages)
}


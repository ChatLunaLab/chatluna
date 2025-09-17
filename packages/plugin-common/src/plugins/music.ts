/* eslint-disable max-len */
import { Tool } from '@langchain/core/tools'
import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    fuzzyQuery,
    getMessageContent
} from 'koishi-plugin-chatluna/utils/string'
import { Config } from '..'
import { elementToString } from './command'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.music !== true) {
        return
    }

    plugin.registerTool('music', {
        selector(history) {
            if (config.musicSelector.length === 0) {
                return true
            }
            return history.some(
                (message) =>
                    message.content != null &&
                    fuzzyQuery(
                        getMessageContent(message.content),
                        config.musicSelector
                    )
            )
        },

        createTool(params) {
            return new MusicTool()
        }
    })
}

export class MusicTool extends Tool {
    name = 'music'

    constructor() {
        super({})
    }

    /** @ignore */
    async _call(input: string, _, config: ChatLunaToolRunnable) {
        const session = config.configurable.session
        try {
            const musicCode = input.trim()
            if (!musicCode) {
                return `Empty input. Please provide valid JavaScript code for music generation.`
            }

            const elements = await session.execute('musicjs ' + musicCode, true)

            await session.send(elements)

            return `Successfully created music with the provided code. Result: ${elementToString(elements)}`
        } catch (e) {
            return `Music generation failed. Error: ${e.message}`
        }
    }

    description = `A music generation tool using JavaScript code. Provide your code directly without any tags.

    Functions:
    - note(tone, beats, temperament = 12): Play a note (equal temperament)
    - noteJust(ratio, beats): Play a note (just intonation)
    - noteHz(frequency, beats): Play a note at specific frequency
    - rest(beats): Add a rest

    Variables:
    - bpm: Tempo (default: 120)
    - baseFrequency: Base frequency (default: 440 Hz)
    - gain: Volume (default: 0.5, range: 0-1)
    - time: Current time in seconds (default: 0)

    Example:
    bpm = 120;
    baseFrequency = 440;
    gain = 0.5;

    note(0, 1);    // A4, 1 beat
    note(2, 0.5);  // B4, 0.5 beats
    rest(0.5);
    note(4, 1);    // C#5, 1 beat

    time = 0;      // New simultaneous track (if needed)
    note(-5, 2);   // E4, 2 beats
`
}

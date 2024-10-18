/* eslint-disable max-len */
import { Tool } from '@langchain/core/tools'
import { Context, Session } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    fuzzyQuery,
    getMessageContent
} from 'koishi-plugin-chatluna/utils/string'
import { Config } from '..'

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
            return history.some(
                (message) =>
                    message.content != null &&
                    fuzzyQuery(getMessageContent(message.content), [
                        'music',
                        'audio',
                        'song',
                        'melody',
                        'tune',
                        'track',
                        '乐曲',
                        '音乐',
                        '歌曲',
                        '旋律',
                        '图',
                        '绘',
                        'draw'
                    ])
            )
        },
        alwaysRecreate: false,

        async createTool(params, session) {
            return new MusicTool(session)
        }
    })
}

export class MusicTool extends Tool {
    name = 'music'

    constructor(public session: Session) {
        super({})
    }

    /** @ignore */
    async _call(input: string) {
        const prefix = resolvePrefixes(this.session)[0] || ''

        try {
            const music = /<code>([\s\S]*?)<\/code>/.exec(input)
            if (music) {
                const musicCode = music[1]
                await this.session.execute(prefix + 'musicjs ' + musicCode)
                return `Successfully create music with prompt ${input}`
            }
            return `Create music with prompt ${input} execution failed, because the result is invalid.`
        } catch (e) {
            return `Create music with prompt ${input} execution failed, because ${e.message}`
        }
    }

    // eslint-disable-next-line max-len

    description = `This tool is a music generation tool with the following methods and properties:
    
    Methods:
    - note(tone: number, beats: number, temperament?: number)
    - noteJust(ratio: number, beats: number)
    - noteHz(frequency: number, beats: number)
    - rest(beats: number)
    
    Properties:
    - bpm (tempo in beats per minute)
    - baseFrequency
    - gain (volume)
    
    When asked to create music, respond with executable JavaScript code using these methods. Your response should be direct calls to these methods, not wrapped in a function. Wrap your code with <code></code> tags. For example:
    
    <code>
    bpm = 120;
    baseFrequency = 440;
    gain = 0.5;
    
    note(60, 1);  // C4 for 1 beat
    note(62, 0.5);  // D4 for 0.5 beats
    rest(0.5);  // Rest for 0.5 beats
    note(64, 1);  // E4 for 1 beat
    
    // Add more notes as needed
    </code>
    
    Describe the music you want.`
}

function resolvePrefixes(session: Session) {
    const value = session.resolve(session.app.config.prefix)

    return Array.isArray(value) ? value : [value || '']
}

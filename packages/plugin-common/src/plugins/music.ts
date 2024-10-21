/* eslint-disable max-len */
import { Tool } from '@langchain/core/tools'
import { Context, Session } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    fuzzyQuery,
    getMessageContent
} from 'koishi-plugin-chatluna/utils/string'
import { Config } from '..'
import { elementToString } from './command'

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
        try {
            const music = /<code>([\s\S]*?)<\/code>/.exec(input)
            if (music) {
                const musicCode = music[1]
                const elements = await this.session.execute(
                    'musicjs ' + musicCode,
                    true
                )

                await this.session.send(elements)

                return `Successfully create music with result ${elementToString(elements)}`
            }
            return `Create music with prompt ${input} execution failed, because the result is invalid.`
        } catch (e) {
            return `Create music with prompt ${input} execution failed, because ${e.message}`
        }
    }

    // eslint-disable-next-line max-len

    description = `A music generation tool using JavaScript code. Wrap your code in <code></code> tags.

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
    <code>
    bpm = 120;
    baseFrequency = 440;
    gain = 0.5;

    note(0, 1);    // A4, 1 beat
    note(2, 0.5);  // B4, 0.5 beats
    rest(0.5);
    note(4, 1);    // C#5, 1 beat

    time = 0;      // New simultaneous track
    note(-5, 2);   // E4, 2 beats
    </code>`
}

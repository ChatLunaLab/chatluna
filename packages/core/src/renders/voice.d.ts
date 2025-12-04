import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from './default'
import { Schema } from 'koishi'
export declare class VoiceRenderer extends Renderer {
    render(message: Message, options: RenderOptions): Promise<RenderMessage>
    private _splitMessage
    private _renderToVoice
    schema: Schema<'voice', 'voice'>
}

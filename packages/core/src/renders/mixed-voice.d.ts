import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from './default'
import { h, Schema } from 'koishi'
export declare class MixedVoiceRenderer extends Renderer {
    render(message: Message, options: RenderOptions): Promise<RenderMessage>
    renderText(messages: h[], options: RenderOptions): Promise<RenderMessage>
    renderVoice(messages: h[], options: RenderOptions): Promise<RenderMessage>
    private _splitMessage
    private _renderToVoice
    schema: Schema<'mixed-voice', 'mixed-voice'>
}

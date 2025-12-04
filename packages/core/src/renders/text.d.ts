import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from './default'
import { h, Schema } from 'koishi'
export declare class TextRenderer extends Renderer {
    render(message: Message, options: RenderOptions): Promise<RenderMessage>
    schema: Schema<'text', 'text'>
}
export declare function transformAndEscape(source: h[]): h[]

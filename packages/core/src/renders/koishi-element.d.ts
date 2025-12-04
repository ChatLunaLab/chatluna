import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from './default'
import { h, Schema } from 'koishi'
export declare class KoishiElementRenderer extends Renderer {
    render(message: Message, options: RenderOptions): Promise<RenderMessage>
    schema: Schema<'koishi-element', 'koishi-element'>
}
export declare function transformAndEscape(source: h[]): h[]

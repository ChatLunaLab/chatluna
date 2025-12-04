import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from './default'
import { h, Schema } from 'koishi'
export declare class PureTextRenderer extends Renderer {
    render(message: Message, options: RenderOptions): Promise<RenderMessage>
    schema: Schema<'pure-text', 'pure-text'>
}
export declare function transformAndEscape(source: string): h[]
export declare function stripMarkdown(source: string): string

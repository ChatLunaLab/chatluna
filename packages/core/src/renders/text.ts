import { Message, RenderMessage, RenderOptions, SimpleMessage } from '../types';
import { buildTextElement } from '../chat';
import { Renderer } from '../render';
import { transform } from 'koishi-plugin-markdown';

export default class TextRenderer extends Renderer {

    async render(message: SimpleMessage, options: RenderOptions): Promise<RenderMessage> {
        return {
            element: transform(message.content),
        }
    }
}
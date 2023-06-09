import { Message, RenderMessage, RenderOptions } from '../types';
import { Renderer } from '../render';
import { transform } from 'koishi-plugin-markdown';
import { h } from 'koishi';

export default class TextRenderer extends Renderer {

    async render(message: Message, options: RenderOptions): Promise<RenderMessage> {

        let transformed = transform(message.text)

        if (options.split) {
            transformed = transformed.map((element) => {
                return h("message", element)
            })
        }

        return {
            element: transformed
        }
    }
}
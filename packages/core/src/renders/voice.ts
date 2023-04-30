
import { Message, RenderMessage, RenderOptions, SimpleMessage } from '../types';
import { Renderer } from '../render';
import "@initencounter/vits"
export default class VoiceRenderer extends Renderer {

    async render(message: SimpleMessage, options: RenderOptions): Promise<RenderMessage> {
        return {
            element: await this.ctx.vits.say({
                speaker_id: options?.voice?.speakerId ?? undefined,
                input: message.content,
            }),
        }
    }


}
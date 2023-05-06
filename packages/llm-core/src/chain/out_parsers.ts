import { Callbacks } from 'langchain/dist/callbacks'
import { BaseOutputParser } from 'langchain/dist/schema/output_parser'

export class ChatHubToolOutputParser extends BaseOutputParser<ChatHubChatAction> {

    async parse(text: string, callbacks?: Callbacks): Promise<ChatHubChatAction> {

        let parsed: ChatHubChatAction

        try {
            parsed = JSON.parse(text)
        } catch (e) {
            // 模型有概率输出非json格式的字符串，这里做一下容错

            // use regex to parse

            parsed = {}

            // "role": "target" | 'role': 'target'
            parsed.role = text.match(/"role":\s*"(.*?)"/)?.[1] || text.match(/'role':\s*'(.*?)'/)?.[1]

            parsed.text = text.match(/"text":\s*"(.*?)"/)?.[1] || text.match(/'text':\s*'(.*?)'/)?.[1]

            if (parsed.role && parsed.text) {
                return parsed
            } else {
                return {
                    commandName: "ERROR",
                    args: { error: `Could not parse invalid json: ${text}` },
                };
            }
        }
    }


    getFormatInstructions(): string {
        throw new Error('Method not implemented.');
    }

}



export interface ChatHubChatAction {
    role?: string;
    text?: string;
    commandName?: string;
    args?: Record<string, any>;
}
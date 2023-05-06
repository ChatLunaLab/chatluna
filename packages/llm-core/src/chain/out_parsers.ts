import { Callbacks } from 'langchain/dist/callbacks'
import { BaseOutputParser } from 'langchain/dist/schema/output_parser'

export class ChatHubChainActionOutputParser extends BaseOutputParser<ChatHubChainAction> {

    async parse(text: string, callbacks?: Callbacks): Promise<ChatHubChainAction> {

        let parsed: ChatHubChainAction

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
                    name: "ERROR",
                    args: { error: `Could not parse invalid json: ${text}` },
                };
            }
        }
    }


    getFormatInstructions(): string {
        throw new Error('Method not implemented.');
    }

}



export interface ChatHubChainAction {
    role?: string;
    text?: string;
    
    name?: string;
    args?: Record<string, any>;
}
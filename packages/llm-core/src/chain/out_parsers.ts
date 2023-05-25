import { Callbacks } from 'langchain/callbacks'
import { BaseOutputParser } from 'langchain/schema/output_parser'



export class ChatHubBrowsingActionOutputParser extends BaseOutputParser<ChatHubBrowsingAction> {

    async parse(text: string, callbacks?: Callbacks): Promise<ChatHubBrowsingAction> {

        let parsed: ChatHubBrowsingAction

        try {
            parsed = JSON.parse(text)


            if (parsed.tool && parsed.args) {
                return parsed
            } else {
                return {
                    tool: "ERROR",
                    args: { error: `Could not parse invalid json: ${text}` },
                };
            }
        } catch (e) {
            return {
                tool: "ERROR",
                args: { error: `Could not parse invalid json: ${text}` },
            };
        }
    }


    getFormatInstructions(): string {
        throw new Error('Method not implemented.');
    }

}


export interface ChatHubBrowsingAction {
    tool?: string
    args?: Record<string, any>
}

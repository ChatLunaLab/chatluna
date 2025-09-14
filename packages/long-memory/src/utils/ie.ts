import { Context } from 'koishi'
import { Config } from '..'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'

export interface Triple {
    subject: string
    predicate: string
    object: string
}

const TRIPLE_PROMPT = (
    text: string
) => `Extract factual triples from the following text as a JSON array.
Each item must be an object with keys: subject, predicate, object.
Keep entities as concise noun phrases in the original language.
If nothing meaningful, return []

Text:
${text}

JSON:`

export async function extractTriples(
    ctx: Context,
    config: Config,
    text: string
): Promise<Triple[]> {
    // If no model configured, return empty
    if (!config.hippoExtractModel || config.hippoExtractModel === '无')
        return []
    try {
        const [platform, modelName] = parseRawModelName(
            config.hippoExtractModel
        )
        const model = (await ctx.chatluna.createChatModel(
            platform,
            modelName
        )) as ChatLunaChatModel
        const res = await model.invoke(TRIPLE_PROMPT(text))
        const content = String(res.content)
        try {
            const parsed = JSON.parse(content)
            if (Array.isArray(parsed)) {
                return parsed
                    .filter((x) => x && typeof x === 'object')
                    .map((x) => ({
                        subject: String((x as any).subject ?? '').trim(),
                        predicate: String((x as any).predicate ?? '').trim(),
                        object: String((x as any).object ?? '').trim()
                    }))
                    .filter((t) => t.subject && t.object)
            }
        } catch {}
        // fallback: try to extract simple pairs via regex is omitted; return empty
        return []
    } catch {
        return []
    }
}

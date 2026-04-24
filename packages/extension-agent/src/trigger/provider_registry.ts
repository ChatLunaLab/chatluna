import { zodToJsonSchema } from 'zod-to-json-schema'
import type { TriggerProvider, TriggerProviderDescriptor } from '../types'

export class ChatLunaAgentTriggerProviderRegistry {
    private readonly _providers = new Map<string, TriggerProvider>()

    register(provider: TriggerProvider) {
        this._providers.set(provider.kind, provider)
        return () => {
            if (this._providers.get(provider.kind) === provider) {
                this._providers.delete(provider.kind)
            }
        }
    }

    get(kind: string | null | undefined) {
        if (kind == null) {
            return
        }

        return this._providers.get(kind)
    }

    list() {
        return Array.from(this._providers.values()).sort((a, b) =>
            a.kind.localeCompare(b.kind)
        )
    }

    listDescriptors(): TriggerProviderDescriptor[] {
        return this.list().map((provider) => ({
            kind: provider.kind,
            name: provider.name,
            description: provider.description,
            passive: provider.passive,
            scheduled: provider.scheduled,
            needsMessage: provider.needsMessage,
            schema: provider.schema
                ? getSchema(provider.kind, provider.schema)
                : undefined
        }))
    }
}

function getSchema(kind: string, schema: TriggerProvider['schema']) {
    const json = zodToJsonSchema(schema!, kind) as {
        definitions?: Record<string, Record<string, unknown>>
    }
    return json.definitions?.[kind] ?? (json as Record<string, unknown>)
}

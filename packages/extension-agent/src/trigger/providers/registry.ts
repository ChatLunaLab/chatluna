import { zodToJsonSchema } from 'zod-to-json-schema'
import type {
    TriggerProviderDef,
    TriggerProviderMeta
} from '../../types/trigger'

export class TriggerProviderRegistry {
    private readonly _items = new Map<string, TriggerProviderDef>()

    register(
        def: TriggerProviderDef,
        onChange?: (event?: 'add' | 'remove') => void
    ) {
        if (this._items.has(def.id)) {
            throw new Error(`Trigger provider already registered: ${def.id}`)
        }
        def.schema.parse(def.defaultConfig)
        this._items.set(def.id, def)
        onChange?.('add')
        return () => {
            if (this._items.get(def.id) !== def) return
            this._items.delete(def.id)
            onChange?.('remove')
        }
    }

    get(id: string) {
        return this._items.get(id)
    }

    list() {
        return [...this._items.values()].sort((a, b) =>
            a.id.localeCompare(b.id)
        )
    }

    require(id: string) {
        const item = this._items.get(id)
        if (item == null) {
            throw new Error(`Unknown trigger provider: ${id}`)
        }
        return item
    }

    parseConfig(id: string, config: unknown) {
        return this.require(id).schema.parse(config)
    }

    meta(id: string, builtin = false): TriggerProviderMeta {
        const item = this.require(id)
        return {
            id: item.id,
            label: item.label,
            description: item.description,
            kind: item.kind,
            builtin,
            schema: toJsonSchema(item.schema, item.id),
            defaultConfig: item.defaultConfig
        }
    }

    listMeta(builtin = false): TriggerProviderMeta[] {
        return this.list().map((item) => ({
            id: item.id,
            label: item.label,
            description: item.description,
            kind: item.kind,
            builtin,
            schema: toJsonSchema(item.schema, item.id),
            defaultConfig: item.defaultConfig
        }))
    }
}

function toJsonSchema(schema: TriggerProviderDef['schema'], name: string) {
    const json = zodToJsonSchema(schema as never, {
        name,
        $refStrategy: 'none'
    }) as Record<string, unknown>
    const defs = json.definitions as
        Record<string, Record<string, unknown>> | undefined
    return defs?.[name] ?? json
}

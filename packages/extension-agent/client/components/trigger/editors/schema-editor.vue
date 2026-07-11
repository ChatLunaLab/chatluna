<template>
    <div class="condition-grid">
        <div
            v-for="field in fields"
            :key="field.key"
            class="field"
            :class="{ 'full-row': field.full }"
        >
            <label>
                {{ field.title }}
                <span v-if="field.required" class="req">*</span>
            </label>
            <div v-if="field.description" class="hint">
                {{ field.description }}
            </div>

            <el-input
                v-if="field.kind === 'string'"
                v-model="model[field.key]"
                :placeholder="field.title"
            />
            <el-input
                v-else-if="field.kind === 'multiline'"
                v-model="model[field.key]"
                type="textarea"
                :rows="3"
                :placeholder="field.title"
            />
            <el-input-number
                v-else-if="field.kind === 'number' || field.kind === 'integer'"
                v-model="model[field.key]"
                :min="field.min"
                :max="field.max"
                :step="field.kind === 'integer' ? 1 : undefined"
                controls-position="right"
            />
            <el-switch
                v-else-if="field.kind === 'boolean'"
                v-model="model[field.key]"
            />
            <el-select
                v-else-if="field.kind === 'enum'"
                v-model="model[field.key]"
                filterable
                :placeholder="field.title"
            >
                <el-option
                    v-for="item in field.enumValues"
                    :key="String(item)"
                    :label="String(item)"
                    :value="item"
                />
            </el-select>
            <el-select
                v-else-if="field.kind === 'array-enum'"
                v-model="model[field.key]"
                multiple
                filterable
                :placeholder="field.title"
            >
                <el-option
                    v-for="item in field.enumValues"
                    :key="String(item)"
                    :label="String(item)"
                    :value="item"
                />
            </el-select>
            <el-select
                v-else-if="field.kind === 'array'"
                v-model="model[field.key]"
                multiple
                filterable
                allow-create
                default-first-option
                :placeholder="field.title"
            />
            <el-input
                v-else
                :model-value="jsonDraft[field.key] ?? ''"
                type="textarea"
                :rows="3"
                @update:model-value="setJsonDraft(field.key, $event)"
                @blur="commitJson(field.key)"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { computed, reactive, watch } from 'vue'

const model = defineModel<Record<string, unknown>>({ required: true })
const props = defineProps<{
    schema: Record<string, unknown>
}>()

const jsonDraft = reactive<Record<string, string>>({})

const fields = computed(() => {
    const root = unwrap(props.schema)
    const properties =
        (root.properties as Record<string, Record<string, unknown>>) ?? {}
    const required = new Set(
        Array.isArray(root.required)
            ? root.required.map((item) => String(item))
            : []
    )
    return Object.entries(properties).map(([key, raw]) => {
        const prop = unwrap(raw)
        const title = String(prop.title ?? key)
        const description =
            typeof prop.description === 'string' ? prop.description : undefined
        const type = prop.type
        const enums = Array.isArray(prop.enum) ? prop.enum : undefined
        const items =
            prop.items != null && typeof prop.items === 'object'
                ? unwrap(prop.items as Record<string, unknown>)
                : undefined
        const itemEnums =
            items != null && Array.isArray(items.enum) ? items.enum : undefined
        let kind: FieldKind = 'json'
        if (enums != null && enums.length > 0) {
            kind = 'enum'
        } else if (type === 'boolean') {
            kind = 'boolean'
        } else if (type === 'integer') {
            kind = 'integer'
        } else if (type === 'number') {
            kind = 'number'
        } else if (type === 'array') {
            kind =
                itemEnums != null && itemEnums.length > 0
                    ? 'array-enum'
                    : 'array'
        } else if (type === 'string') {
            if (
                prop.format === 'textarea' ||
                (typeof prop.maxLength === 'number' && prop.maxLength > 120)
            ) {
                kind = 'multiline'
            } else {
                kind = 'string'
            }
        }
        return {
            key,
            title,
            description,
            required: required.has(key),
            full:
                kind === 'multiline' ||
                kind === 'array' ||
                kind === 'array-enum' ||
                kind === 'json',
            kind,
            min: typeof prop.minimum === 'number' ? prop.minimum : undefined,
            max: typeof prop.maximum === 'number' ? prop.maximum : undefined,
            enumValues: (enums ?? itemEnums) as
                Array<string | number | boolean> | undefined,
            defaultValue: prop.default
        } satisfies Field
    })
})

watch(
    [fields, () => model.value] as const,
    ([list, current], previous) => {
        const replaced = previous != null && current !== previous[1]
        if (replaced) {
            for (const key of Object.keys(jsonDraft)) delete jsonDraft[key]
        }

        const next = { ...current }
        let changed = false
        for (const field of list) {
            if (
                next[field.key] === undefined &&
                field.defaultValue !== undefined
            ) {
                next[field.key] = structuredClone(field.defaultValue)
                changed = true
            }
            if (field.kind !== 'json' || jsonDraft[field.key] != null) continue
            const value = next[field.key]
            if (value == null) {
                jsonDraft[field.key] = ''
            } else if (typeof value === 'string') {
                jsonDraft[field.key] = value
            } else {
                jsonDraft[field.key] = JSON.stringify(value, null, 2)
            }
        }
        if (changed) model.value = next
    },
    { immediate: true }
)

type FieldKind =
    | 'string'
    | 'multiline'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'enum'
    | 'array'
    | 'array-enum'
    | 'json'

interface Field {
    key: string
    title: string
    description?: string
    required: boolean
    full: boolean
    kind: FieldKind
    min?: number
    max?: number
    enumValues?: Array<string | number | boolean>
    defaultValue?: unknown
}

function unwrap(schema: Record<string, unknown>) {
    if (schema == null) return {}
    if (schema.$ref != null && typeof schema.$ref === 'string') return schema
    if (Array.isArray(schema.anyOf) && schema.anyOf[0]) {
        return unwrap(schema.anyOf[0] as Record<string, unknown>)
    }
    if (Array.isArray(schema.oneOf) && schema.oneOf[0]) {
        return unwrap(schema.oneOf[0] as Record<string, unknown>)
    }
    if (!Array.isArray(schema.allOf)) return schema

    let result: Record<string, unknown> = schema
    for (const item of schema.allOf) {
        const part = unwrap(item as Record<string, unknown>)
        const properties = {
            ...((result.properties as Record<string, unknown>) ?? {}),
            ...((part.properties as Record<string, unknown>) ?? {})
        }
        const required = [
            ...new Set([
                ...(Array.isArray(result.required)
                    ? result.required.map((key) => String(key))
                    : []),
                ...(Array.isArray(part.required)
                    ? part.required.map((key) => String(key))
                    : [])
            ])
        ]
        result = {
            ...result,
            ...part,
            properties
        }
        if (required.length > 0) result.required = required
    }
    return result
}

function setJsonDraft(key: string, raw: string) {
    jsonDraft[key] = raw
}

function commitJson(key: string) {
    const raw = jsonDraft[key] ?? ''
    if (raw.trim() === '') {
        model.value[key] = null
        return
    }
    try {
        model.value[key] = JSON.parse(raw)
    } catch {
        // Keep the last valid model value; only surface a warning.
        ElMessage.warning(`字段“${key}”不是合法的 JSON。`)
    }
}
</script>

<style scoped>
@import './editor.css';

.hint {
    margin-top: -2px;
    color: var(--k-text-light);
    font-size: 12px;
    line-height: 1.4;
}

.req {
    color: var(--el-color-danger);
}
</style>

<template>
    <div class="rule-grid">
        <div class="field-card">
            <div class="field-label">模式</div>
            <el-select v-model="value.mode">
                <el-option label="inherit" value="inherit" />
                <el-option label="all" value="all" />
                <el-option label="allow" value="allow" />
                <el-option label="deny" value="deny" />
            </el-select>
        </div>
        <div class="field-card full-row">
            <div class="field-label">Allow 列表</div>
            <el-select
                v-if="hasOptions"
                v-model="allowValues"
                multiple
                filterable
                clearable
                collapse-tags
                collapse-tags-tooltip
                placeholder="选择多个允许项"
            >
                <el-option
                    v-for="item in options"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value"
                />
            </el-select>
            <el-input
                v-else
                v-model="value.allowText"
                type="textarea"
                :rows="3"
                placeholder="用逗号或换行分隔"
            />
        </div>
        <div class="field-card full-row">
            <div class="field-label">Deny 列表</div>
            <el-select
                v-if="hasOptions"
                v-model="denyValues"
                multiple
                filterable
                clearable
                collapse-tags
                collapse-tags-tooltip
                placeholder="选择多个拒绝项"
            >
                <el-option
                    v-for="item in options"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value"
                />
            </el-select>
            <el-input
                v-else
                v-model="value.denyText"
                type="textarea"
                :rows="3"
                placeholder="用逗号或换行分隔"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface RuleDraft {
    mode: string
    allowText: string
    denyText: string
}

interface RuleOption {
    label: string
    value: string
}

const props = withDefaults(
    defineProps<{
        modelValue: RuleDraft
        options?: RuleOption[]
    }>(),
    {
        options: undefined
    }
)

const emit = defineEmits<{
    'update:modelValue': [value: RuleDraft]
}>()

const value = computed({
    get: () => props.modelValue,
    set: (next: RuleDraft) => emit('update:modelValue', next)
})

const hasOptions = computed(() => (props.options?.length ?? 0) > 0)

function splitItems(text: string) {
    return text
        .split(/[\n,]/g)
        .map((item) => item.trim())
        .filter(
            (item, idx, list) => item.length > 0 && list.indexOf(item) === idx
        )
}

const allowValues = computed({
    get: () => splitItems(value.value.allowText),
    set: (next: string[]) => {
        value.value = {
            ...value.value,
            allowText: next.join(', ')
        }
    }
})

const denyValues = computed({
    get: () => splitItems(value.value.denyText),
    set: (next: string[]) => {
        value.value = {
            ...value.value,
            denyText: next.join(', ')
        }
    }
})
</script>

<style scoped>
.rule-grid {
    display: grid;
    gap: 14px;
}

.field-card {
    padding: 14px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(
        in srgb,
        var(--k-side-bg),
        var(--k-page-bg) 18%
    );
}

.field-card.full-row {
    grid-column: 1 / -1;
}

.field-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
    margin-bottom: 8px;
}
</style>

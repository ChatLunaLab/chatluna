<template>
    <div class="rule-grid">
        <div class="field-card flat-card scope-row">
            <div>
                <div class="field-label">模式</div>
                <div class="field-help" style="max-width: 400px;">
                    <span v-if="value.mode === 'inherit'">
                        <b>继承 (inherit)</b>：当前 Agent 继承自它的父级会话的权限配置。
                    </span>
                    <span v-else-if="value.mode === 'all'">
                        <b>全部允许 (all)</b>：当前 Agent 拥有此权限范围内的所有功能。
                    </span>
                    <span v-else-if="value.mode === 'allow'">
                        <b>白名单 (allow)</b>：仅允许当前 Agent 使用列表中指定的项。
                    </span>
                    <span v-else-if="value.mode === 'deny'">
                        <b>黑名单 (deny)</b>：当前 Agent 可以使用除了列表项之外的所有功能。
                    </span>
                </div>
            </div>
            <el-select v-model="value.mode" style="width: 240px;">
                <el-option
                    v-if="allowInherit"
                    label="继承 (inherit)"
                    value="inherit"
                />
                <el-option label="全部允许 (all)" value="all" />
                <el-option label="白名单 (allow)" value="allow" />
                <el-option label="黑名单 (deny)" value="deny" />
            </el-select>
        </div>

        <div v-if="value.mode === 'allow'" class="field-card flat-card full-row" style="margin-top: 12px;">
            <div class="field-label" style="margin-bottom: 8px;">允许的项 (Allow)</div>
            <el-select
                v-if="hasOptions"
                v-model="allowValues"
                multiple
                filterable
                clearable
                collapse-tags
                collapse-tags-tooltip
                placeholder="选择多个允许项"
                style="width: 100%;"
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
                placeholder="用逗号或换行分隔多个名称"
            />
        </div>

        <div v-if="value.mode === 'deny'" class="field-card flat-card full-row" style="margin-top: 12px;">
            <div class="field-label" style="margin-bottom: 8px;">拒绝的项 (Deny)</div>
            <el-select
                v-if="hasOptions"
                v-model="denyValues"
                multiple
                filterable
                clearable
                collapse-tags
                collapse-tags-tooltip
                placeholder="选择多个拒绝项"
                style="width: 100%;"
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
                placeholder="用逗号或换行分隔多个名称"
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
        allowInherit?: boolean
    }>(),
    {
        options: undefined,
        allowInherit: true
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
    display: flex;
    flex-direction: column;
}

.field-card {
    padding: 14px 0;
    border-radius: 14px;
    box-sizing: border-box;
}

.flat-card {
    background: transparent;
    border: none;
    padding: 0;
}

.full-row {
    grid-column: 1 / -1;
}

.field-label {
    font-size: 15px;
    font-weight: 500;
    color: var(--k-text-dark);
}

.field-help {
    margin-top: 6px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--k-text-light);
}

.scope-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

@media (max-width: 768px) {
    .scope-row {
        flex-direction: column;
        align-items: flex-start;
    }
    
    .scope-row .el-select {
        width: 100% !important;
    }
}
</style>

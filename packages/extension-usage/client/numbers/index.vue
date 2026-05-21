<template>
    <div class="card-grid chatluna-usage-number-grid" v-if="usage">
        <k-slot name="chatluna-usage-number">
            <k-slot-item>
                <numeric title="总调用">
                    <template #default>{{ fmt(usage.totals.calls) }}</template>
                    <template #footer-left>成功</template>
                    <template #footer-right>{{ fmt(usage.totals.successfulCalls) }}</template>
                </numeric>
                <numeric title="Total Tokens">
                    <template #default>{{ fmt(usage.totals.totalTokens) }}</template>
                    <template #footer-left>估算</template>
                    <template #footer-right>{{ fmt(usage.totals.estimatedTokens) }}</template>
                </numeric>
                <numeric title="Input Tokens">
                    <template #default>{{ fmt(usage.totals.inputTokens) }}</template>
                    <template #footer-left>Output</template>
                    <template #footer-right>{{ fmt(usage.totals.outputTokens) }}</template>
                </numeric>
                <numeric title="成功率">
                    <template #default>{{ pct(usage.totals.successRate) }}</template>
                    <template #footer-left>失败</template>
                    <template #footer-right>{{ fmt(usage.totals.failedCalls) }}</template>
                </numeric>
            </k-slot-item>
        </k-slot>
    </div>
</template>

<script setup lang="ts">
import Numeric from './numeric.vue'
import { fmt, pct, usage } from '../state'
</script>

<style lang="scss" scoped>
.chatluna-usage-number-grid {
    grid-template-columns: repeat(4, 1fr);

    @media screen and (max-width: 1280px) {
        grid-template-columns: repeat(2, 1fr);
    }

    @media screen and (max-width: 768px) {
        grid-template-columns: 1fr;
    }
}
</style>

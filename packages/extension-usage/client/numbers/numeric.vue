<template>
    <k-card class="k-chatluna-usage-number">
        <div class="content">
            <p class="title">{{ title }}</p>
            <p class="value"><slot>-</slot></p>
        </div>
        <template #footer>
            <span class="left"><slot name="footer-left">-</slot></span>
            <span class="right"><slot name="footer-right">-</slot></span>
        </template>
    </k-card>
</template>

<script lang="ts" setup>
defineProps<{
    title: string
}>()
</script>

<style lang="scss">
.k-chatluna-usage-number .k-card-body {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    margin: 1rem 0;

    .content {
        text-align: right;
    }

    p {
        margin: 0;
        font-size: 0.9375rem;
    }

    .value {
        margin-top: 0.25rem;
        font-size: 1.25rem;
        font-weight: 600;
    }
}

.k-chatluna-usage-number footer {
    font-size: 0.9em;
    border-top: 1px solid var(--k-card-border);
    padding-top: 0.75rem;
    margin-bottom: 0.75rem;
    display: flex;
    justify-content: space-between;
}
</style>

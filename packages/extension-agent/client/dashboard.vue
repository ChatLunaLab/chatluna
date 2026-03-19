<template>
    <k-layout class="dashboard-root">
        <agent-shell />
    </k-layout>
</template>

<script setup lang="ts">
import AgentShell from './components/layout/agent-shell.vue'
</script>

<style scoped>
.dashboard-root {
    min-height: 100vh;
}
</style>

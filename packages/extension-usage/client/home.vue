<template>
    <number-grid />

    <div class="card-grid chart-grid chatluna-usage-charts">
        <k-slot name="chatluna-usage-chart"></k-slot>
    </div>

    <k-card class="frameless chatluna-usage-filter">
        <template #header>
            <span>ChatLuna 用量查询</span>
            <span class="actions">
                <el-button :loading="loading" type="primary" @click="refresh">
                    刷新
                </el-button>
                <el-button :loading="loading" @click="resetFilters">
                    重置
                </el-button>
            </span>
        </template>

        <div class="filter-grid">
            <label>
                粒度
                <el-select v-model="query.period" @change="search">
                    <el-option label="按日" value="day" />
                    <el-option label="按月" value="month" />
                    <el-option label="按年" value="year" />
                </el-select>
            </label>
            <label class="span-2">
                指定时间
                <el-date-picker
                    v-model="range"
                    type="datetimerange"
                    start-placeholder="开始时间"
                    end-placeholder="结束时间"
                    value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
                    @change="changeRange"
                />
            </label>
            <label>
                聚合
                <el-select v-model="query.groupBy" @change="search">
                    <el-option label="按模型" value="model" />
                    <el-option label="按群" value="guild" />
                    <el-option label="按来源" value="source" />
                    <el-option label="按模型平台" value="platform" />
                    <el-option label="按聊天平台" value="chatPlatform" />
                    <el-option label="按调用类型" value="callType" />
                </el-select>
            </label>
            <label>
                聚合排序
                <el-select v-model="query.sortBy" @change="search">
                    <el-option label="总 Token" value="totalTokens" />
                    <el-option label="调用数" value="calls" />
                    <el-option label="输入 Token" value="inputTokens" />
                    <el-option label="输出 Token" value="outputTokens" />
                    <el-option label="成功率" value="successRate" />
                    <el-option label="失败数" value="failedCalls" />
                </el-select>
            </label>
            <label>
                明细排序
                <el-select v-model="query.listSortBy" @change="search">
                    <el-option label="时间" value="createdAt" />
                    <el-option label="总 Token" value="totalTokens" />
                    <el-option label="输入 Token" value="inputTokens" />
                    <el-option label="输出 Token" value="outputTokens" />
                </el-select>
            </label>
            <label>
                方向
                <el-select v-model="query.listDesc" @change="search">
                    <el-option label="倒序" :value="true" />
                    <el-option label="正序" :value="false" />
                </el-select>
            </label>
        </div>

        <el-divider content-position="left">手写条件查询</el-divider>

        <div class="filter-grid query-grid">
            <el-input v-model="query.keyword" placeholder="关键词" clearable />
            <el-input v-model="query.model" placeholder="模型包含" clearable />
            <el-input v-model="query.source" placeholder="来源包含" clearable />
            <el-input v-model="query.guildId" placeholder="群 ID 包含" clearable />
            <el-input v-model="query.userId" placeholder="用户 ID 包含" clearable />
            <el-input v-model="query.platform" placeholder="模型平台包含" clearable />
            <el-input
                v-model="query.chatPlatform"
                placeholder="聊天平台包含"
                clearable
            />
            <el-select v-model="query.callType" clearable placeholder="调用类型">
                <el-option label="LLM" value="llm" />
                <el-option label="Embeddings" value="embeddings" />
                <el-option label="Reranker" value="reranker" />
            </el-select>
            <el-select v-model="query.success" clearable placeholder="成功状态">
                <el-option label="成功" :value="true" />
                <el-option label="失败" :value="false" />
            </el-select>
            <el-select v-model="query.estimated" clearable placeholder="Token 类型">
                <el-option label="估算" :value="true" />
                <el-option label="接口返回" :value="false" />
            </el-select>
            <el-button :loading="loading" type="primary" @click="search">
                查询
            </el-button>
        </div>
    </k-card>

    <k-card class="frameless chatluna-usage-table">
        <template #header>
            <span>调用明细</span>
            <span>{{ usage?.list.total ?? 0 }} 条</span>
        </template>
        <el-table :data="usage?.list.rows ?? []" stripe>
            <el-table-column label="时间" width="190">
                <template #default="scope">
                    {{ time(scope.row.createdAt) }}
                </template>
            </el-table-column>
            <el-table-column prop="model" label="模型" min-width="180" />
            <el-table-column prop="source" label="来源" min-width="160" />
            <el-table-column prop="guildId" label="群" min-width="120" />
            <el-table-column prop="userId" label="用户" min-width="120" />
            <el-table-column prop="callType" label="类型" width="120" />
            <el-table-column prop="totalTokens" label="Token" width="110" sortable />
            <el-table-column label="状态" width="100">
                <template #default="scope">
                    <el-tag :type="scope.row.success ? 'success' : 'danger'">
                        {{ scope.row.success ? '成功' : '失败' }}
                    </el-tag>
                </template>
            </el-table-column>
        </el-table>
        <el-pagination
            class="pager"
            layout="prev, pager, next, sizes, total"
            :total="usage?.list.total ?? 0"
            :current-page="query.page"
            :page-size="query.pageSize"
            :page-sizes="[20, 50, 100, 200]"
            @current-change="changePage"
            @size-change="changeSize"
        />
    </k-card>
</template>

<script lang="ts" setup>
import NumberGrid from './numbers/index.vue'
import {
    changeRange,
    loading,
    query,
    range,
    refresh,
    resetFilters,
    search,
    time,
    usage
} from './state'

function changePage(page: number) {
    query.page = page
    refresh()
}

function changeSize(size: number) {
    query.page = 1
    query.pageSize = size
    refresh()
}
</script>

<style lang="scss">
.card-grid {
    display: grid;
    margin: var(--card-margin);
    grid-gap: var(--card-margin);
}

.chart-grid {
    .echarts {
        width: 100%;
        max-width: 100%;
        min-height: 360px;
        margin: 0 auto;
    }

    @media (min-width: 1280px) {
        grid-template-columns: repeat(2, 1fr);
    }

    @media (max-width: 1280px) {
        grid-template-columns: 1fr;
    }
}

.chatluna-usage-charts {
    align-items: stretch;
}

.chatluna-usage-filter,
.chatluna-usage-table {
    margin: var(--card-margin);
}

.chatluna-usage-filter header,
.chatluna-usage-table header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
}

.chatluna-usage-filter .actions {
    display: flex;
    gap: 0.5rem;
}

.chatluna-usage-filter .filter-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1rem;
}

.chatluna-usage-filter .query-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
}

.chatluna-usage-filter label {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    color: var(--k-text-light);
}

.chatluna-usage-filter .span-2 {
    grid-column: span 2;
}

.chatluna-usage-table .pager {
    justify-content: flex-end;
    margin-top: 1rem;
}

@media (max-width: 1280px) {
    .chatluna-usage-filter .filter-grid,
    .chatluna-usage-filter .query-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@media (max-width: 768px) {
    .chatluna-usage-filter .filter-grid,
    .chatluna-usage-filter .query-grid {
        grid-template-columns: 1fr;
    }

    .chatluna-usage-filter .span-2 {
        grid-column: auto;
    }
}
</style>

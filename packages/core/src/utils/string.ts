// 导出一个模糊查询的函数，参数是一个字符串和一个字符串数组，返回值是一个布尔值
export function fuzzyQuery(source: string, keywords: string[]): boolean {
    // 遍历每一个关键词
    for (const keyword of keywords) {
        const match = source.includes(keyword)
        // 如果距离小于等于最大距离，说明匹配成功，返回 true
        if (match) {
            return true
        }
    }
    // 如果遍历完所有关键词都没有匹配成功，返回 false
    return false
}

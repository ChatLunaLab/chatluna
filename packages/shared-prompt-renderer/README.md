# @chatluna/shared-prompt-renderer

[![npm](https://img.shields.io/npm/v/@chatluna/shared-prompt-renderer)](https://www.npmjs.com/package/@chatluna/shared-prompt-renderer) [![npm](https://img.shields.io/npm/dm/@chatluna/shared-prompt-renderer)](https://www.npmjs.com/package/@chatluna/shared-prompt-renderer)

> ChatLuna Prompt 模板渲染器

## 特性

- **类 JavaScript 语法**: 熟悉的语法，支持函数调用、成员访问和运算符
- **控制流渲染**: 支持 `if/else` 条件判断和 `for` 循环
- **任意扩展**: 支持自定义变量和函数，可扩展性高
- **对象与数组支持**: 访问嵌套属性和数组元素
- **类型安全**: 使用 TypeScript 编写，完整的类型定义
- **异步支持**: 支持异步变量提供器和函数

## 安装

```bash
npm install @chatluna/shared-prompt-renderer
```

## 快速开始

```typescript
import { ChatLunaPromptRenderer } from '@chatluna/shared-prompt-renderer'

const renderer = new ChatLunaPromptRenderer()

// 注册函数
renderer.registerFunctionProvider('upper', (args) => {
    return args[0]?.toUpperCase() ?? ''
})

// 渲染模板
const result = await renderer.render(
    'Hello {upper(name)}!',
    { name: 'world' }
)

console.log(result.text) // "Hello WORLD!"
```

## 语法

### 变量插值

使用花括号访问变量：

```bash
{variable}
```

**示例：**

```typescript
await renderer.render('Hello {name}!', { name: 'Alice' })
// 输出: "Hello Alice!"
```

### 对象成员访问

使用点号访问对象属性（就像 JavaScript 一样）：

```bash
{object.property}
{user.name}
{config.settings.theme}
```

**示例：**

```typescript
await renderer.render(
    'User: {user.name}, Age: {user.age}',
    { user: { name: 'Bob', age: 25 } }
)
// 输出: "User: Bob, Age: 25"
```

### 数组索引访问

使用方括号访问数组元素（就像 JavaScript 一样）：

```bash
{array[0]}
{items[1]}
{matrix[0][1]}
```

**示例：**

```typescript
await renderer.render(
    'First: {items[0]}, Second: {items[1]}',
    { items: ['apple', 'banana', 'cherry'] }
)
// 输出: "First: apple, Second: banana"
```

### 函数调用

调用注册的函数，传递参数：

```bash
{func(arg1, arg2)}
{upper(name)}
{concat("Hello", " ", name)}
```

**示例：**

```typescript
renderer.registerFunctionProvider('concat', (args) => {
    return args.join('')
})

await renderer.render(
    '{concat("Hello", " ", name, "!")}',
    { name: 'World' }
)
// 输出: "Hello World!"
```

### 运算符

> 如果你学习过 JavaScript，你应该会很熟悉下面的语法。可以选择跳过该段落。

#### 算术运算符

```bash
{a + b}     // 加法
{a - b}     // 减法
{a * b}     // 乘法
{a / b}     // 除法
{a % b}     // 取模
```

#### 比较运算符

```bash
{a == b}    // 等于
{a != b}    // 不等于
{a > b}     // 大于
{a < b}     // 小于
{a >= b}    // 大于等于
{a <= b}    // 小于等于
```

#### 逻辑运算符

```bash
{a && b}    // 逻辑与
{a || b}    // 逻辑或
{!a}        // 逻辑非
```

#### 一元运算符

```bash
{-a}        // 取负
{+a}        // 取正
{!a}        // 逻辑非
```

**示例：**

```typescript
await renderer.render(
    'Result: {count > 10 ? "Many" : "Few"}',
    { count: 15 }
)
// 输出: "Result: Many"
```

### 条件表达式

使用三元运算符进行内联条件判断：

```bash
{condition ? trueValue : falseValue}
{score >= 60 ? "Pass" : "Fail"}
```

**示例：**

```typescript
await renderer.render(
    'Status: {age >= 18 ? "Adult" : "Minor"}',
    { age: 20 }
)
// 输出: "Status: Adult"
```

### If/Else 块

使用 `if` 块进行条件渲染：

```bash
{if condition}
  条件为真时的内容
{/if}

{if condition}
  条件为真时的内容
{else}
  条件为假时的内容
{/if}
```

**示例：**

```typescript
await renderer.render(
    '{if loggedIn}Welcome, {username}!{else}Please log in.{/if}',
    { loggedIn: true, username: 'Alice' }
)
// 输出: "Welcome, Alice!"
```

### For 循环

使用 `for` 循环遍历数组：

```bash
{for item in items}
  {item}
{/for}
```

**示例：**

```typescript
await renderer.render(
    '{for name in names}{name}, {/for}',
    { names: ['Alice', 'Bob', 'Charlie'] }
)
// 输出: "Alice, Bob, Charlie, "
```

**嵌套循环：**

```typescript
await renderer.render(
    '{for row in matrix}{for cell in row}{cell} {/for}\\n{/for}',
    { matrix: [[1, 2], [3, 4]] }
)
// 输出: "1 2 \n3 4 \n"
```

### 转义花括号

使用双花括号输出字面花括号：

```bash
{{This will be rendered as {This will be rendered as}}}
```

**示例：**

```typescript
await renderer.render('Use {{variable}} for interpolation')
// 输出: "Use {variable} for interpolation"
```

## API 参考

### ChatLunaPromptRenderer

主渲染器类。

#### 构造函数

```typescript
const renderer = new ChatLunaPromptRenderer()
```

#### 方法

##### `registerVariableProvider(provider: VariableProvider): () => void`

注册变量提供器函数。

```typescript
renderer.registerVariableProvider(() => ({
    currentTime: () => new Date().toISOString(),
    version: '1.0.0'
}))
```

返回一个注销函数用于移除该提供器。

##### `registerFunctionProvider(name: string, provider: FunctionProvider): () => void`

注册自定义函数。

```typescript
renderer.registerFunctionProvider('upper', (args, configurable) => {
    return args[0]?.toUpperCase() ?? ''
})
```

返回一个注销函数用于移除该函数。

##### `render(source: string, variables?: Record<string, any>, options?: RenderOptions): Promise<RenderResult>`

渲染模板字符串。

```typescript
const result = await renderer.render(
    'Hello {name}!',
    { name: 'World' },
    { maxDepth: 5 }
)

console.log(result.text)      // 渲染后的文本
console.log(result.variables) // 检测到的变量
```

### 类型定义

#### VariableProvider

```typescript
type VariableProvider = () => Record<string, any>
```

返回变量记录。值可以是：

- 静态值：`{ name: 'Alice' }`
- 函数：`{ time: () => new Date() }`

#### FunctionProvider

```typescript
type FunctionProvider = (
    args: string[],
    configurable: Record<string, unknown>
) => Promise<string> | string
```

函数接收：

- `args`: 已求值的参数字符串数组
- `configurable`: 配置对象（如 session、context）

返回函数结果字符串。

#### RenderOptions

```typescript
interface RenderOptions {
    extensions?: {
        variableProviders?: VariableProvider[]
        functionProviders?: Record<string, FunctionProvider>
    }
    configurable?: Record<string, unknown>
    maxDepth?: number  // 默认: 10
}
```

- `extensions`: 本次渲染的额外提供器
- `configurable`: 传递给函数提供器的配置
- `maxDepth`: 嵌套渲染的最大深度

#### RenderResult

```typescript
interface RenderResult {
    text: string        // 渲染输出
    variables: string[] // 检测到的变量名列表
}
```

## 具体示例

### 复杂模板

```typescript
const template = `
{if user}
  Hello {user.name}!

  {if user.isPremium}
    You have premium access.
  {else}
    Upgrade to premium for more features.
  {/if}

  Your items:
  {for item in user.items}
    - {item.name}: {item.price}
  {/for}
{else}
  Please log in to continue.
{/if}
`

const result = await renderer.render(template, {
    user: {
        name: 'Alice',
        isPremium: true,
        items: [
            { name: 'Item 1', price: 10 },
            { name: 'Item 2', price: 20 }
        ]
    }
})
```

### 带 Configurable 的自定义函数

```typescript
renderer.registerFunctionProvider('translate', async (args, configurable) => {
    const key = args[0]
    const locale = configurable.locale || 'en'
    // 从 i18n 系统获取翻译
    return await getTranslation(key, locale)
})

const result = await renderer.render(
    '{translate("greeting")}',
    {},
    { configurable: { locale: 'zh-CN' } }
)
```

### 嵌套渲染

函数参数会递归渲染：

```typescript
renderer.registerFunctionProvider('upper', (args) => args[0]?.toUpperCase())

const result = await renderer.render(
    '{upper({name})}',
    { name: 'alice' }
)
// 输出: "ALICE"
```

### 传递上下文，给函数执行

```typescript
renderer.registerFunctionProvider('getUserName', async (args, configurable) => {
    const session = configurable.session as Session
    return session?.user?.name || 'Guest'
})

const result = await renderer.render(
    'Welcome, {getUserName()}!',
    {},
    { configurable: { session: mySession } }
)
```

## 从旧语法迁移

旧语法（`{func:arg1::arg2}`）在此版本中**不再支持**。更新您的模板：

| 旧语法 | 新语法 |
|--------|--------|
| `{func:arg1::arg2}` | `{func(arg1, arg2)}` |
| `{variable}` | `{variable}` (不变) |
| N/A | `{obj.prop}` (新) |
| N/A | `{arr[0]}` (新) |
| N/A | `{if cond}...{/if}` (新) |

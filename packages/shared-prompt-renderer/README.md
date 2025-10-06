# @chatluna/shared-prompt-renderer

[![npm](https://img.shields.io/npm/v/@chatluna/shared-prompt-renderer)](https://www.npmjs.com/package/@chatluna/shared-prompt-renderer) [![npm](https://img.shields.io/npm/dm/@chatluna/shared-prompt-renderer)](https://www.npmjs.com/package/@chatluna/shared-prompt-renderer)

> ChatLuna Prompt 模板渲染器

## 特性

- **类 JavaScript 语法**: 熟悉的语法，支持函数调用、成员访问和运算符
- **控制流渲染**: 支持 `if/elseif/else` 多级条件判断、`for` 循环、`while` 循环和 `repeat` 循环
- **灵活的循环**: `for` 循环用于数组遍历，`while` 循环用于条件循环，`repeat` 循环用于固定次数重复
- **函数灵活调用**: 函数可作为变量调用，支持返回值的多级属性访问
- **任意扩展**: 支持自定义变量和函数，可扩展性高
- **对象与数组支持**: 访问嵌套属性和数组元素
- **类型安全**: 使用 TypeScript 编写，完整的类型定义
- **异步支持**: 支持异步变量提供器和函数

## 安装

```lua
npm install @chatluna/shared-prompt-renderer
```

## 快速开始

```typescript
import { ChatLunaPromptRenderer } from '@chatluna/shared-prompt-renderer'

const renderer = new ChatLunaPromptRenderer()

// 注册函数
renderer.registerFunctionProvider('upper', (args, variables, configurable) => {
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

```lua
{variable}
```

**示例：**

```typescript
await renderer.render('Hello {name}!', { name: 'Alice' })
// 输出: "Hello Alice!"
```

### 对象成员访问

使用点号访问对象属性（就像 JavaScript 一样）：

```lua
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

```lua
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

```lua
{func(arg1, arg2)}
{upper(name)}
{concat("Hello", " ", name)}
```

**函数作为变量调用：**

如果一个注册的函数名被当作变量访问（不带括号），它会被自动调用（不传递参数）：

```typescript
renderer.registerFunctionProvider('getTime', () => {
    return new Date().toISOString()
})

await renderer.render('Current time: {getTime}')
// 输出: "Current time: 2025-01-15T10:30:00.000Z"
```

**多级调用：**

函数返回的对象可以继续访问属性或调用方法：

```typescript
renderer.registerFunctionProvider('getUser', () => {
    return { name: 'Alice', age: 25, profile: { city: 'Beijing' } }
})

await renderer.render('User: {getUser().name}, City: {getUser().profile.city}')
// 输出: "User: Alice, City: Beijing"
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

```lua
{a + b}     // 加法
{a - b}     // 减法
{a * b}     // 乘法
{a / b}     // 除法
{a % b}     // 取模
```

#### 比较运算符

```lua
{a == b}    // 等于
{a != b}    // 不等于
{a > b}     // 大于
{a < b}     // 小于
{a >= b}    // 大于等于
{a <= b}    // 小于等于
```

#### 逻辑运算符

```lua
{a && b}    // 逻辑与
{a || b}    // 逻辑或
{!a}        // 逻辑非
```

#### 一元运算符

```lua
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

```lua
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

```lua
{if condition}
  条件为真时的内容
{/if}

{if condition}
  条件为真时的内容
{else}
  条件为假时的内容
{/if}
```

**多级 If-ElseIf-Else：**

支持多个条件分支：

```lua
{if condition1}
  条件1为真时的内容
{elseif condition2}
  条件2为真时的内容
{elseif condition3}
  条件3为真时的内容
{else}
  所有条件都为假时的内容
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

**多级示例：**

```typescript
await renderer.render(
    '{if score >= 90}优秀{elseif score >= 80}良好{elseif score >= 60}及格{else}不及格{/if}',
    { score: 85 }
)
// 输出: "良好"
```

### For 循环

使用 `for` 循环遍历数组：

```lua
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

### While 循环

使用 `while` 循环根据布尔条件重复渲染：

```lua
{while condition}
  循环内容
{/while}
```

条件必须返回布尔值。当条件为真时继续循环，为假时停止。

为了防止无限循环，while 循环有最大迭代次数限制（10000次）。超过限制会在控制台输出警告并停止循环。

**示例：**

```typescript
await renderer.render(
    '{while hasMore}Processing...{/while}',
    { hasMore: true }
)
// 注意: 这个例子不会改变 hasMore 的值，实际应用中需要在循环体内更新变量
// 或使用外部逻辑控制条件
```

### Repeat 循环

使用 `repeat` 循环进行固定次数的重复：

```lua
{repeat count}
  循环内容
{/repeat}
```

`count` 应该是一个返回数字的表达式。如果返回值不是数字或小于0，会在控制台输出警告并跳过循环。

**示例：**

```typescript
await renderer.render(
    '{repeat 3}Hello {/repeat}',
    {}
)
// 输出: "Hello Hello Hello "
```

**使用变量或函数：**

```typescript
await renderer.render(
    '{repeat count}* {/repeat}',
    { count: 5 }
)
// 输出: "* * * * * "
```

```typescript
renderer.registerFunctionProvider('getLoopCount', () => '3')

await renderer.render(
    '{repeat getLoopCount()}Loop {/repeat}',
    {}
)
// 输出: "Loop Loop Loop "
```

### 转义花括号

使用双花括号作为转义序列输出单个花括号字符：

- `{{` 输出字面字符 `{`
- `}}` 输出字面字符 `}`

**示例：**

```typescript
await renderer.render('Use {{variable}} for interpolation')
// 输出: "Use {variable} for interpolation"

await renderer.render('{{if}} is a control structure')
// 输出: "{if} is a control structure"

await renderer.render('JSON object: {{ "key": "value" }}')
// 输出: "JSON object: { "key": "value" }"
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

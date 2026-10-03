# 二十四点精确求解与验算后端

TypeScript + Node.js + SQLite 的**纯后端**二十四点服务（HTTP API + CLI）。
四张数字牌（1–13 的整数，允许重复数值）用且仅用一次，只允许 `+ - * /` 和括号，
目标固定为 24。全程使用 BigInt 有理数精确计算，**不使用浮点容差**，不会把接近 24 的值误判为 24。

* 运行环境：Windows 本地，Node.js >= 22.5（开发与实测环境 Node v25.5.0）
* SQLite：使用 Node **内置模块** `node:sqlite`，无需 C++ 编译工具链、Docker、WSL 或任何在线服务
* 数据目录：项目内 `data/point24.db`（可用环境变量 `P24_DATA_DIR` 更改）

## 快速开始

```powershell
npm install        # 仅安装 typescript 与 @types/node
npm run build      # 编译到 dist/
npm test           # 构建并运行 13 个测试
npm run demo       # 完整 CLI 演示
npm start          # 启动 HTTP API（默认自动选择空闲端口，控制台输出实际端口）
$env:PORT=8080; npm start   # 指定端口
```

## 实体牌语法

每张实体牌有独立编号 `c1`、`c2`、`c3`、`c4`（大小写不敏感，也可写 `C1`）。
**牌面数值相同不等于同一张牌**：例如 3,3,8,8 中两张 3 分别是 `c1`、`c2`，两张 8 分别是 `c3`、`c4`。

* 只允许：`c1`–`c4` 引用、`+` `-` `*` `/`、括号 `( )`、空白
* **不支持**：数字字面量（不能直接写 `24`、`8` 等常数）、连接数字（`38`）、乘方 `^`、阶乘 `!`、
  取模、函数、变量、其它运算符；也不使用 `eval` / `new Function` 执行输入
* 每张牌必须**恰好出现一次**；重复使用同一张牌（如 `c1*c1*c3*c4`）报 `CARD_COUNT_ERROR`

经典解 `8/(3-8/3)` 在本项目中的实体牌写法（取第一张 8 为 `c3`、第二张 8 为 `c4`）：

```
c3/(c1-c4/c2)
```

逐步精确计算：

```
(c4/c2)            = (8/3)        = 8/3
(c1-(c4/c2))       = (3-(8/3))    = 1/3
(c3/(c1-(c4/c2)))  = (8/(3-(8/3)))= 24
```

## 去重口径

搜索对“牌集合”做记忆化子集 DP，合并不相交子集时枚举全部运算符（减法、除法两个方向都枚举），
因此覆盖所有二叉树（括号）形状，允许中间结果为分数、零、负数；除零分支直接跳过。

去重按**规范化表达式结构字符串**进行：

* 叶子是实体牌编号，重复数值的牌不会互相混淆；
* 交换运算（`+`、`*`）的两个子树按规范串排序，消除交换律重复（如 `c1+c2` 与 `c2+c1` 视为同一个）；
* 减法/除法不交换，`a-b` 与 `b-a`、`a/b` 与 `b/a` 是不同结构；
* 不做跨节点的代数重排（避免口径不透明）。

`totalCount` 是完成**全量枚举并去重后**的解总数；`limit` 只影响返回/展示切片（`returnedCount`），
不影响搜索完备性。**只有搜索完整结束后才会判定无解**。

## CLI

```powershell
node dist/src/cli.js list
node dist/src/cli.js import mydeck "自定义" 4,6,6,6
node dist/src/cli.js solve classic-3388 3          # 第3个参数为展示上限
node dist/src/cli.js solutions classic-3388 5      # 以 JSON 查看有限解列表
node dist/src/cli.js explain classic-3388 "c3/(c1-c4/c2)"
node dist/src/cli.js check classic-3388 "c1*c1*c3*c4"
node dist/src/cli.js export data/export.json
node dist/src/cli.js import-file data/export.json
node dist/src/cli.js demo
```

修改牌面（且牌面确实变化）会为该牌例产生一个**新版本**，旧版本与旧求解永久保留；仅改名不升版本。
求解/验算可指定历史版本号。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| GET | `/api/decks` | 牌例列表 |
| GET | `/api/decks/:id` | 牌例详情（含最新版本与牌面） |
| POST | `/api/decks` | 导入/更新牌例：`{id,name,cards:[4个1..13]}` |
| POST | `/api/decks/:id/solve` | 求解：`{limit?,target?,version?}`，结果落库 |
| POST | `/api/decks/:id/check` | 验算外部表达式：`{expression,version?,target?}`，报告落库 |
| POST | `/api/decks/:id/explain` | 对表达式逐步输出精确分数 |
| GET | `/api/decks/:id/solves` | 历史求解记录 |
| GET | `/api/decks/:id/checks` | 历史验算报告 |
| GET | `/api/export` | 导出全部牌例/求解/验算 JSON |
| POST | `/api/import` | 导入 `{decks:[...]}` |

示例（PowerShell）：

```powershell
$b = "http://127.0.0.1:<端口>"
Invoke-RestMethod -Method Post "$b/api/decks/classic-3388/solve" `
  -ContentType "application/json" -Body '{"limit":3}'
Invoke-WebRequest -Method Post "$b/api/decks/classic-3388/check" `
  -ContentType "application/json" -Body '{"expression":"c1*c1*c3*c4"}'
```

## 错误码

| 错误码 | 含义 |
| --- | --- |
| `INVALID_CARDS` / `INVALID_ID` / `INVALID_TARGET` / `INVALID_LIMIT` | 参数校验失败 |
| `DECK_NOT_FOUND` / `VERSION_NOT_FOUND` | 牌例或版本不存在 |
| `EMPTY_EXPRESSION` | 表达式为空 |
| `ILLEGAL_CHAR` | 非法字符/不支持的运算/裸数字字面量 |
| `UNKNOWN_CARD` | 使用了不存在的牌编号（如 `c9`） |
| `SYNTAX_ERROR` | 括号不匹配、记号位置错误等语法问题 |
| `CARD_COUNT_ERROR` | 有牌重复使用或遗漏，未做到每牌恰好一次 |
| `DIVIDE_BY_ZERO` | 表达式求值中出现除以零 |
| `WRONG_RESULT` | 语法与用牌均合法，但结果精确值不等于 24 |
| `INVALID_JSON` / `PAYLOAD_TOO_LARGE` / `NOT_FOUND` / `INTERNAL` | 传输与路由错误 |

验算合法但结果错误时，仍会返回已算出的逐步分数（如 `1+1+1+1 = 4`），便于核对。

## 精确性与交叉验证

* `src/rational.ts`：分子分母 BigInt，每次运算约分、分母统一转正；除法分母为 0 返回 `null`。
* `src/solver.ts`：子集 DP 全量精确搜索。
* `src/referenceSolver.ts`：**独立参考枚举器**——4! 个叶子排列 × 4³ 个运算符组合 × 五种
  Catalan 二叉树形状，与子集 DP 完全不同的实现；测试对 1..6 的全部多组合同花牌例（126 个）
  逐一核对可解性完全一致。
* 所有返回解都会再交给独立验算器（`src/parser.ts`）重新解析与精确求值，校验每牌一次且结果为 24。

## SQLite 表

* `decks` / `deck_versions`：牌例与版本历史（牌面变化才升版本）
* `solves`：求解配置（target、limit）、可解性、去重后总数、返回解 JSON；相同配置重复求解结果稳定（唯一键去重）
* `checks`：每次外部表达式验算的完整报告 JSON

重启服务后可直接读取历史求解，并基于保存的表达式重建逐步解释（`npm run demo` 第 9 步演示）。

## 范围限制

* 仅做后端 API 与 CLI，不提供网页界面
* 固定 4 张牌、目标 24（求解器内部支持 target 参数，但牌数/数值域按需求固定校验）
* 搜索规模为 4 张牌的全量枚举，不扩展为任意张数、概率游戏或在线对局
* `node:sqlite` 在当前 Node 版本会打印一条 ExperimentalWarning，功能不受影响

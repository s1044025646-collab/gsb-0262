# 二十四点精确表达式求解与验算后端

只做后端（API + CLI）的二十四点求解服务。四张数字牌（每张为 1～13 的整数，允许数值重复但
每张实体牌有独立编号），只能用加、减、乘、除和括号，每张牌恰好用一次，目标固定为 24。

- **全程精确**：自行实现有理数（`BigInt` 分子/分母约分），不使用浮点数或容差，
  `23.9999999` 绝不会被当成 24。
- **完整枚举**：递归子集组合搜索，允许分数、零、负数中间结果；除零分支跳过；
  减法与除法两个方向都搜索；非左结合的各种括号形状都能覆盖。
- **独立验算**：用户表达式由独立的解析器（无 `eval` / `new Function`）处理，
  校验牌使用情况并逐步输出精确分数。
- **SQLite 持久化**：保存牌例版本、求解配置、结果与验算报告，重启后可读取；
  同名修改牌面会产生新版本。

技术栈：TypeScript + Node.js（内置 `node:http`、`node:sqlite`、`node:test`），
无第三方运行时依赖，无需 Docker / WSL / 在线服务。需要 Node 22 以上（开发验证于 Node 25，
`node:sqlite` 会输出一条 ExperimentalWarning，属正常现象）。

## 实体牌语法

- 牌按导入顺序编号为 `c1`、`c2`、`c3`、`c4`（也接受 `#1`…`#4`、大写 `C1`）。
- 数值相同的牌编号不同。例如 `[3,3,8,8]` 中 `c1`、`c2` 是两张 3，`c3`、`c4` 是两张 8。
- 表达式只允许牌引用、`+ - * /`、括号和空白；**不接受裸数字字面量**，
  因此不能通过写 `8/3` 绕过“每张牌用一次”。
- 不支持一元负号、连接数字（如 `13` 由 `1` 和 `3` 拼成）、乘方、阶乘、
  取模、函数调用或任何其它运算。

经典解 `8/(3-8/3)` 在 `[3,3,8,8]` 下写作（四张牌各一次）：

```
c4 / (c1 - c3 / c2)
```

计算过程为 `c3/c2 = 8/3`，`c1 - 8/3 = 1/3`，`c4 ÷ 1/3 = 24`。

## 去重口径

搜索在每个子集内部按“规范化结构键”去重，只消除明显等价结果：

- 加法、乘法：子表达式拍平后排序，因此 `a+b` 与 `b+a`、`(a*b)*c` 与 `a*(b*c)` 视为同一个。
- 减法、除法：**保持左右顺序**，`a-b` 与 `b-a` 不算等价。
- 叶子以实体牌编号表示：数值相同但编号不同的牌互换（如两张 3）仍是不同的解。
- 不做代数级化简识别（例如不把 `a+a-a` 与 `a` 判为同解），宁可多留，保证正确性直观。

返回数量上限（`limit`，默认 20，最大 1000）**只截断展示**；`totalFound` 与
“有解/无解”结论始终来自完整搜索。只有完整搜索结束且命中数为 0 时才判定无解。

## 构建、测试、启动与演示

```powershell
npm install
npm run build
npm test
npm run demo
npm start -- --port 8731   # 不传 --port（或 PORT 环境变量）时自动选择空闲端口
```

数据库与数据目录位于项目内 `data/point24.db`（自动创建）。

## CLI

```
node dist/src/cli.js import <名称> <牌面>      例：import mine 3,3,8,8
node dist/src/cli.js solve <名称> [上限]       完整求解，上限仅限制展示
node dist/src/cli.js show <结果编号>           查看历史有限解列表
node dist/src/cli.js explain <结果编号> [下标]  某解的逐步精确分数计算
node dist/src/cli.js verify <名称> <表达式>     验算外部表达式
node dist/src/cli.js reference <牌面>          五种二叉树参考枚举交叉核对
node dist/src/cli.js export                    导出全部牌例版本 JSON
node dist/src/cli.js serve [--port 端口]        启动 HTTP API
node dist/src/cli.js demo                      内置完整演示
```

内置牌例（`serve` 或 `demo` 时自动确保存在）：

- `builtin-3388`：3,3,8,8，展示需要分数中间值的 `8/(3-8/3)` 型解。
- `builtin-1111`：1,1,1,1，完整搜索后明确无解。

### 验算错误码

| 错误码 | 含义 |
| --- | --- |
| `PARSE_ERROR` | 非法字符、括号不配对、运算符位置错误等语法问题 |
| `UNKNOWN_CARD` | 引用了不存在的牌编号（如只有 c1..c4 却写 c5） |
| `CARD_REPEATED` | 某张实体牌出现超过一次 |
| `CARD_COUNT_MISMATCH` | 使用牌数与牌例不符（缺牌或多牌） |
| `ZERO_DIVISION` | 计算过程中除以零 |
| `NOT_TARGET` | 表达式合法且每张牌各用一次，但精确结果不等于 24 |

## HTTP API

仅监听 `127.0.0.1`。

| 方法与路径 | 说明 |
| --- | --- |
| `GET /health` | 健康检查 |
| `POST /api/decks` | 导入牌例：`{"name":"d","cards":[3,3,8,8],"target":24}` |
| `POST /api/solve` | 求解：`{"name":"d","limit":10}` |
| `GET /api/solves/{id}` | 查看有限解列表（重启后仍可读取） |
| `GET /api/solves/{id}/explain?index=0` | 逐步精确分数解释 |
| `POST /api/verify` | 验算：`{"name":"d","expression":"c4/(c1-c3/c2)"}` |
| `GET /api/verifies/{id}` | 读取历史验算报告 |
| `GET /api/export` | 导出全部牌例版本 |

参数错误统一返回 HTTP 400 与 `{"error":{"code","message"}}`，代码与 CLI 一致
（`INVALID_CARDS`、`INVALID_NAME`、`INVALID_TARGET`、`INVALID_LIMIT`、
`DECK_NOT_FOUND`、`RECORD_NOT_FOUND`）。

```powershell
$body = '{"name":"api-demo","cards":[3,3,8,8]}'
Invoke-RestMethod http://127.0.0.1:8731/api/decks -Method Post -Body $body -ContentType 'application/json'
Invoke-RestMethod http://127.0.0.1:8731/api/solve -Method Post -Body '{"name":"api-demo","limit":3}' -ContentType 'application/json'
Invoke-RestMethod http://127.0.0.1:8731/api/verify -Method Post -Body '{"name":"api-demo","expression":"c4/(c1-c3/c2)"}' -ContentType 'application/json'
```

## 参考枚举（交叉验证）

`reference`（及测试中）独立枚举四张叶子的全部 `4! = 24` 个排列、`4^3 = 64` 个运算符组合
与 Catalan 数 `C3 = 5` 种完全二叉树形状（共 7680 个候选树，除零跳过），
与主递归搜索在多组小牌例上的“可解/无解”结论完全一致；主搜索返回的每一个解都会
再次交给独立验算器求值确认等于 24。

## 范围与限制

- 仅实现后端 API 与 CLI，不包含前端界面、在线对局、概率/猜牌游戏或脚本执行能力。
- 求解器限定 4 张牌的业务校验；通用递归搜索最多支持 12 张内部使用。
- `node:sqlite` 在当前 Node 版本标注为实验特性，升级 Node 大版本时请回归测试。

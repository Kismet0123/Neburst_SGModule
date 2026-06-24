# Neburst SGModule

用于 Surge 的 Neburst OpenAPI 只读监控模块，可展示实例概览、流量、资源占用和账户余额。

本项目只调用只读接口，不包含开机、关机、重启、重装、救援等控制类功能。

- Neburst OpenAPI 原仓库：[neburstnetworks/openapi](https://github.com/neburstnetworks/openapi)
- Neburst Dashboard：[dash.neburst.com](https://dash.neburst.com)

## 模块说明

本仓库提供三种使用方式。

### 1. 单模块 4 个 Panel

文件：

```text
Neburst_Monitor.sgmodule
```

作用：

- 显示实例概览
- 显示流量监控
- 显示资源监控
- 显示账户余额

适合想一次导入完整监控的人。缺点是首次添加后可能同时刷新多个 Panel，容易碰到 Neburst 的 5 秒请求间隔限制。

订阅地址：

```text
https://raw.githubusercontent.com/Kismet0123/Neburst_SGModule/main/Neburst_Monitor.sgmodule
```

### 2. 四个独立模块

文件：

```text
Neburst_Overview.sgmodule
Neburst_Traffic.sgmodule
Neburst_Metrics.sgmodule
Neburst_Balance.sgmodule
```

作用：

| 模块 | 用途 |
| --- | --- |
| `Neburst_Overview.sgmodule` | 实例名称、状态、IP、地区、系统、续费信息 |
| `Neburst_Traffic.sgmodule` | 流量已用、总量、剩余、使用比例 |
| `Neburst_Metrics.sgmodule` | CPU、内存、磁盘、网络速率 |
| `Neburst_Balance.sgmodule` | 账户可用余额、锁定余额、币种 |

适合只想展示部分信息的人。例如只关心流量，就只导入 `Neburst_Traffic.sgmodule`。

订阅地址：

```text
https://raw.githubusercontent.com/Kismet0123/Neburst_SGModule/main/Neburst_Overview.sgmodule
https://raw.githubusercontent.com/Kismet0123/Neburst_SGModule/main/Neburst_Traffic.sgmodule
https://raw.githubusercontent.com/Kismet0123/Neburst_SGModule/main/Neburst_Metrics.sgmodule
https://raw.githubusercontent.com/Kismet0123/Neburst_SGModule/main/Neburst_Balance.sgmodule
```

### 3. 单模块 1 个 Panel，自定义展示项

文件：

```text
Neburst_Summary.sgmodule
```

作用：

- 只生成一个 Surge Panel
- 通过参数控制是否展示实例概览、流量、资源、余额

适合想保持面板简洁的人。

订阅地址：

```text
https://raw.githubusercontent.com/Kismet0123/Neburst_SGModule/main/Neburst_Summary.sgmodule
```

可选参数：

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `show_overview` | 是否展示实例概览 | `true` |
| `show_traffic` | 是否展示流量监控 | `true` |
| `show_metrics` | 是否展示资源监控 | `true` |
| `show_balance` | 是否展示账户余额 | `true` |

示例：只显示流量和资源：

```text
show_overview:false
show_traffic:true
show_metrics:true
show_balance:false
```

## 使用方法

### 1. 在 Neburst 创建 API Key

进入 [Neburst Dashboard](https://dash.neburst.com)，找到 API Key 或 OpenAPI 相关页面，创建一个新的 API Key。

创建后会得到一个 combined Base64 API Key，形态类似：

```text
eyJrZXlfaWQiOiJuYl9rZXlfLi4uIiwic2VjcmV0IjoibmJfc2VjcmV0Xy4uLiJ9
```

在 Surge 模块参数里填入：

```text
api_key
```

注意：API Secret 通常只显示一次，丢失后需要重新创建或轮换 API Key。

### 2. 获取实例 ID

实例 ID 指 Neburst 实例 UUID。

常见获取方式：

- 在 Neburst Dashboard 的实例详情页查看。
- 如果页面 URL 或详情信息里包含一段 UUID，通常就是实例 ID。
- UUID 形态类似：

```text
a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

在 Surge 模块参数里填入：

```text
id
```

如果只使用账户余额模块 `Neburst_Balance.sgmodule`，不需要实例 ID。

### 3. 选择实例类型

参数：

```text
type
```

可选值：

| 值 | 说明 |
| --- | --- |
| `instance` | 普通云实例，默认值 |
| `bare-metal` | 独立服务器 |

如果不确定，保持默认 `instance`。

### 4. 配置刷新间隔

单 Panel 模块使用：

```text
interval
```

单位是秒。例如：

```text
interval:900
```

表示 900 秒刷新一次。

单模块 4 Panel 版本使用独立刷新参数：

```text
overview_interval:1800
traffic_interval:600
metrics_interval:300
balance_interval:3600
```

## API 权限 Scope

按你实际使用的模块给 API Key 分配权限即可。

| 功能 | 需要 scope |
| --- | --- |
| 普通云实例概览、流量、资源 | `instance:read` |
| 独立服务器概览、流量、资源 | `bare-metal:read` |
| 账户余额 | `billing:read` |

本模块不需要以下权限：

```text
instance:power
bare-metal:power
bare-metal:rebuild
bare-metal:rescue
```

## 限流说明

Neburst OpenAPI 当前限制：

- 每用户每分钟最多 60 次请求
- 每用户每 5 秒最多 1 次请求

建议：

- 如果只需要少量信息，优先使用四个独立模块。
- 如果想界面简洁，使用 `Neburst_Summary.sgmodule`。
- 不建议把刷新间隔设置得太短。

`Neburst_Summary.sgmodule` 如果同时展示多个项目，会在脚本内部顺序请求多个接口，并在请求之间等待约 5.5 秒，以降低触发限流的概率。

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `Neburst_Monitor.js` | 公共脚本，负责签名、请求和渲染 |
| `Neburst_Monitor.sgmodule` | 单模块 4 Panel |
| `Neburst_Overview.sgmodule` | 实例概览单 Panel |
| `Neburst_Traffic.sgmodule` | 流量监控单 Panel |
| `Neburst_Metrics.sgmodule` | 资源监控单 Panel |
| `Neburst_Balance.sgmodule` | 账户余额单 Panel |
| `Neburst_Summary.sgmodule` | 单模块 1 Panel，全参数控制 |
| `test_neburst_monitor.js` | 本地测试脚本 |

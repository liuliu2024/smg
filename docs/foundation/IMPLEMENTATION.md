# 校园场景服务底座实施记录

v5.0 决定首版工程与运行合同，v4.2 补充后台治理操作和验收。附件 SQL 原样纳入 001 迁移。现有 v3 学生门户和 SQLite 演示保留，底座使用独立 PostgreSQL schema 和演示数据库。

| v5 工程默认 | 当前落地与原因 |
|---|---|
| Node 22、TypeScript、pnpm、Next 15 | 复用已有 Node 24、Next 16、React 19、npm 锁文件和 ESM。v3 依赖 Node 24 的内置 SQLite，改动整个门户会扩大迁移范围。 |
| apps/web、worker、packages/core | 原 Web 宿主挂载 /foundation，foundation/ 共享权限、目录、发布、运行和存储。独立 Node worker 读 PostgreSQL jobs。 |
| PostgreSQL 16 与参数化 SQL | pg 参数化查询。001 权威初始 schema，后续迁移强化联合外键并增加运行所需数据表。迁移校验 SHA-256 并在同一事务登记。 |
| Ajv、Zod、decimal.js、Vitest、Playwright | Ajv 校验能力合同，Zod 校验管理输入，decimal.js 计量。沿用已有 Node 测试与 Playwright，并使用真实 PG16 隔离库。 |
| /api/v1 与后台路由 | v5 资源路径挂到 /api/v1/foundation，避免与 v3 的同名路由冲突。独立界面使用 /foundation 下的页面导航。 |

Web 会话、环境选择、运行查询和数据写入均带学校边界。演示环境显式启用两所虚构学校，每个连接使用本校独立的回调密钥引用。操作员按服务范围工作，审批人和提交人按真实账号比较。身份映射由演示适配器读取。当前仅 DEMO 环境可激活运行，TEST 环境用于配置和合同检查。

发布校验生成不可变依赖快照与摘要。测试 worker 实际执行静态定义与能力合同正反例，结果绑定发布代次。激活锁定服务和版本，检查依赖、测试和独立审批，再切换当前版本。已有实例继续引用原发布。真实供应商配置与校园身份仍处于 NOT_CONNECTED。

## 运行

1. 准备专用 PostgreSQL 16 库。可用 compose.foundation.yml 启动本机 PostgreSQL，或使用已授权的演示实例。
2. 执行 npm ci。将专用数据库 URL 设置为当前终端的 DATABASE_URL。
3. 执行 npm run foundation:configure、npm run foundation:migrate、npm run foundation:seed。配置生成只接受回环地址，不覆盖已有 .env.foundation。
4. 执行 npm run foundation:dev，访问 http://localhost:3015/foundation。默认沿用 Web 宿主并启动独立的底座 worker。
5. 分进程启动可用 npm run build、npm run foundation:start:web、npm run foundation:start:worker。APP_MODE 指业务环境，Next 生产构建仍可用于明确的本地 DEMO。

迁移不会读取 v3 SQLite 文件。演示重置要求 APP_MODE=demo、匹配的安装标记和显式 --confirm，仅操作专用的 campus_foundation schema。测试使用由测试程序创建的随机数据库。通过 FOUNDATION_TEST_DATABASE_URL 提供有临时建库权限的测试集群连接，执行 npm run test:integration。生产需要另行配置运行账号、密钥存储、SSO 和外部授权。

## 验收范围

发布测试证明合同和定义静态校验，三个场景的运行及异常恢复另外执行真实 PostgreSQL 集成测试。部署与真实设备、支付、通知需要校方材料和授权。详见本阶段交付记录与用例。

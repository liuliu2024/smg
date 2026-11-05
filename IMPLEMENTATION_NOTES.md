# 实施偏差与当前边界

最新合同是docs/v3/SPEC_V3.txt。当前不代表80项全完成，逐F状态见V3_FEATURE_STATUS.md。本文件替换旧“全部JSON”“缺Playwright”等过时结论。

复用Next.js16/React19宿主、Node24原生JavaScript界面、Node SQLite、Lucide及pdf-lib；未改TypeScript组件/Tailwind/shadcn/Prisma/Vitest。v3允许复用健康工程，但不豁免关系模型、权限、事务、验收要求。现有Playwright真实浏览器测试。

核心经repositories-v3迁入独立typed表，含FK/索引/业务唯一；事务BEGIN IMMEDIATE/嵌套SAVEPOINT。typed_core_v3_2从旧records迁移核心并保留恢复archive，有真实保留/FK/回滚测试。B域campus/extensions/utilities仍JSON records，全域关系模型尚不合格，不能只换表名抵扣。

M1已有8h hash会话、10角色/18账号、活动身份隔离、强幂等创建、10分钟报价、hash+AES-GCM凭证、只读业务投影、订单餐饮反馈、指南版本、打印费率规则、连接、outbox尝试/UNKNOWN人工核实、范围分析/深健康。实际范围和未验收字段见状态矩阵，不把同名页面算完整流程。

商品productId唯一仅默认规格，非完整多规格；规则执行器只有PRINT_PRICE。B主要SERVICE范围，完整部门节点/实体资源/教学班模型未完成。运营群发、ServiceDefinition、复杂表单/审批/候补/场次仍缺。部分分页meta嵌于data、旧动作路径保留，统一API/全部规范路由待收口。

UI已分任务首页与/apps卡片墙，224px侧栏/64px顶栏、手机底部导航。最新99服务测试与3 Playwright通过，其中2项API/布局、1项真实手机餐饮反馈多身份按钮闭环；构建成功。非80项全覆盖；24h幂等TTL、更多迁移故障、全部按钮和生产容量未验证。

测试曾因静态导入早于DB_PATH设置写默认演示库，已隔离重跑、备份和精准清理；DB现测试缺DB_PATH开库前拒绝。物理PDF存储尚未全隔离；完整历史见TEST_REPORT，不隐藏失败。

连接仅本地配置校验，真实企业微信/身份/设备/支付/教学未接通，无公网部署。生产无真实认证拒绝演示业务。demo随机密钥须随DB备份；生产需外置密钥。db:migrate含bootstrap/seed，非纯DDL工具；.env.example未覆盖全部生产要求。未建立可保证会话结束后继续开发的自动交付安排。

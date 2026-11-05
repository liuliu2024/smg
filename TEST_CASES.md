# v3 M1 测试用例与证据

历史80项只能作为旧版回归，不代表v3的29个功能已验收。以下以真实执行文件为准。

| ID | 覆盖 | 执行证据/当前状态 |
|---|---|---|
| T-DB-RELATIONS/ROLLBACK | typed核心表、FK、无核心records副本、事务回滚 | v3.test.mjs 已真实通过 |
| T-DB-LEGACY | 构造旧records库，子进程真实迁移保留用户，FK检查0 | v3.test.mjs 已真实通过 |
| T-SEC-SESSION-8H/PENDING/MULTI | session八小时、未授权pending拒服务、多角色活动身份隔离 | v3.test.mjs 已真实通过 |
| T-F18-KEY/EXPIRE/CONSUME/OWNER/PRICE | 报价10分钟契约、缺key拒绝、过期/消费/变价409及越权404 | v3.test.mjs 已真实通过 |
| T-F20-ENCRYPT/RESTART/ONCE | AES非明文落库、第二进程重启恢复、仅本人READY、模拟付款及重复核销 | v3.test.mjs 已真实通过 |
| T-F17-RETENTION | 孤立文件24小时、终态7天、处理中保留 | v3.test.mjs 已真实通过 |
| T-F06-PROJECTION | 本人聚合记录、打印点人员范围、学生无后台待办、日历90天边界 | v3.test.mjs 已真实通过 |
| T-SEC-429 | demo登录每IP阈值后429 | v3.test.mjs 已真实通过 |
| T-F11/F17/F21-E2E | Playwright独立学生及三职员上下文三核心API闭环、390/768/1440布局、匿名401 | npm run test:e2e 已真实2通过；不是逐按钮UI闭环 |
| T-SEC-SUPER-PRIVATE/SCOPE | SERVICE_AGENT/RESOURCE_MANAGER/DEPARTMENT_REVIEWER + typed SERVICE范围，超管和运营不默认处理私密B | 正向夹具与拒绝/HTTP即时撤销负例均真实通过 |

尚需补充或完成：按29个M1 F逐项正向/权限/异常矩阵、组织循环/typed scope错误类型、全部会话管理接口、幂等24小时失效、任务1/5/15分钟重试及10分钟锁、完整页面逐按钮Playwright、更多生产边界与迁移异常。不得把未执行项写为通过。

最新全量97通过、0失败；Playwright2通过。F49/F69/F75/F76/F80及组织循环/类型目标范围校验已加v3.test.mjs实际通过。任务5分钟旧断言已替换为10分钟UNKNOWN人工核实与1/5/15分钟退避。上述旧“尚需”段为阶段记录；仍需完整逐F矩阵、幂等TTL、逐按钮UI和生产验证，具体以上述最新结果为准。

最新全量99通过、0失败；新增T-DB-TEST-GUARD与T-F72请求追踪及分析范围/脱敏。测试保护在DB打开前拒绝缺失DB_PATH的Node测试上下文。


## 最终执行证据

服务104通过（96业务子项+8父项）、Playwright3通过，均实际执行退出0。新增持久化QC用例：指南草稿目标部门scope、3新role本人入口、迟到租约finish防覆盖、confirmed-complete同步outbox、home.todos与/tasks一致并排除SUBMITTED。

浏览器：tests/e2e/mobile-feedback.spec.mjs覆盖F27/F29手机逐按钮学生模拟付款点餐及反馈→独立商户回复解决→学生刷新确认；core.spec.mjs核心标签F10/F17/F19/F28。不是所有页面逐按钮完整覆盖。隔离reset确认后种子还原增加无角色账号及本地指南存在校验。

逐文件清理并发瞬间的确定性故障注入、所有F的完整三类矩阵、幂等24h TTL以及生产容量仍属于额外验证范围，物理PDF存储路径尚未完全隔离。当前报告不得据测试总数代替这些未执行项。

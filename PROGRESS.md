# Development progress

Source: SPEC.txt extracted from the uploaded implementation specification.

- Repository inspected: initially empty; initialized main baseline remotely.
- Working branch: feat/campus-p0.
- Developer A: portal, mobile and admin interface (in progress).
- Developer B: persistence, authorization and core workflows (in progress).
- QC: independent review (in progress).
- Test agent: follows QC when a concurrency slot is free.
- No test results claimed yet.
- Git clone and npm require network-enabled execution; both connectivity checks succeeded.
- Scheduled delivery tool returned an approval-policy error. No automation created; work occurs in this active session.

GitHub tracking: https://github.com/liuliu2024/smg/issues/1
Notion: https://app.notion.com/p/40e264a5f88a81dbb4e1db6612f1286d

Target: 2026-11-05 09:00 Asia/Shanghai. Actual completion subject to implemented and verified scope.

## 当前交付状态

已实现并验证本地核心闭环、服务器分页/筛选排序、配置运营、时段库存、任务领取重试、一次性核销、跨进程幂等。企业微信式密集工作台完成真实浏览器验收，见design-qa.md。Draft PR #2。

已测试：49项自动化通过0失败（以TEST_REPORT最终命令为准），Next正式构建成功；新工作台PC/移动与后台翻页已检查。

待接入：企微真实OAuth/成员映射、学校SSO、设备/图书馆/支付接口。

尚未达到完整规格的技术项：原生JS界面和Node SQLite JSON模型未采用要求的TypeScript/Prisma规范化关系模型；无完整生产容量与备份恢复演练。不要将演示交付表述为全部P0验收通过。

自动定时交付：已尝试创建，因工具审批策略拒绝未建立；当前会话之外没有持续开发承诺。

最后成功命令：npm test；npm run build。下一步：按QC报告完成默认栈与关系模型迁移，再取得企微应用配置开展P1联调。

## 用户追加范围交付

新增8模块、10类统一办事申请、校园/志愿/竞赛活动类型；同义目录合并并支持搜索别名。当前13可用入口、12分类，首页优先可用，规划目录显式切换。真实浏览器报修完整闭环与搜索已验证，手机无横向溢出。最新66测试通过，最终构建见命令输出。

调度自动交付仍受工具审批策略阻断，未创建；本轮持续工作均在本次活跃会话中完成。现有GitHub CI可自动检查提交。规范化关系架构/真实企微/生产接入仍待补齐，PR保留草稿，不虚称全部规格完成。

## 需求与UI岗位扩展

按用户明确要求新增独立需求工程师H与UI工程师。H交付REQUIREMENTS.md、FEATURE_MATRIX.md、RESEARCH_NOTES.md；矩阵85项操作能力，不等于85模块或每项独立浏览器测试。当前实际31 ACTIVE入口，目录170项；UI默认精选80卡，可展开全部。统一单套图标文字侧栏，管理后台末位。新增6个业务模块和12工具已实施，测试/QC独立80项通过。

## 自动安排最新状态

权限环境更新后，真实创建成功：automation-6夜间开发，Asia/Shanghai 02:30/04:30/06:30，共3次；automation-5早间演示验收，08:30一次。工具返回ACTIVE且automation配置已读取。早先被拒为历史状态；当前安排已建立，执行仍依赖本机应用/调度环境可用，不承诺关闭应用或离线仍运行。

## 最新浏览器证据

IAB：默认80张卡实际children.length80，左侧单一图标分类且后台末位；创建个人待办并完成，问卷动态选择两题并提交成功；个人日程保存与编辑均显示北京时间2026-11-07 10:00/11:00；390/430视口scrollWidth分别375/415。修复后17:20UTC之后脚本错误日志为空。31模块PC与移动截图已保存outputs/screenshots。

## 企业微信准备

官方开发者手册页面访问失败已如实记录，未核实存在立即可用的虚拟企业/独立沙箱。腾讯官方OneID文档能证部分管理员、企业参数和可信配置，不能把其产品专用步骤直接套用本项目。计划采用内部自建网页应用，尚未真实注册或部署；细目和不确定性见RESEARCH_NOTES.md。

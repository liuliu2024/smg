# 校园服务平台

云栖职业技术学院为演示名称，身份与学校业务均为虚构。本地可运行门户、手机页面、管理后台及图书、打印、餐饮核心闭环；用户上传的v3.0规格为最新合同。当前为v3 M1实施版，不能称F01—F80全部开发或验收完成。逐项状态见 [V3_FEATURE_STATUS.md](V3_FEATURE_STATUS.md)。

## 启动与检查

要求Node.js 24 LTS与npm，在仓库目录执行：

```powershell
npm ci
Copy-Item .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

已有.env时保留已有设置。打开 http://localhost:3000 。dev同时启动Next.js与每60秒运行的worker；start同样启动worker，不必再双开。修改端口时同步PORT、APP_ORIGIN；修改请求校验Origin，使用localhost。当前Web只监听本机127.0.0.1，未部署公网。

首次导入服务端会幂等创建/迁移数据库并补演示种子；db:migrate当前也包含bootstrap/seed，不能当作纯DDL生产迁移工具。启动不清空现有数据库。

```powershell
npm test
npm run build
npm start
```

浏览器测试：`npm run test:e2e`，配置会启动隔离测试服务，要求可用的本机Chrome。`npm run test:ui`是另一个截图检查脚本，要求先启动localhost:3000，默认输出artifacts/screenshots，支持SCREENSHOT_DIR。

最新记录104项服务测试通过、0失败；Playwright最近3项通过：2项核心浏览器上下文API/布局检查，另1项真实390手机点击学生登录、餐单/模拟付款/反馈，商户独立上下文回复解决，学生刷新查处理记录。构建通过。这些数字不是功能完成数，详见 [TEST_REPORT.md](TEST_REPORT.md)。

独立运行：`npm run start:standalone`为轻量HTTP服务，不替代Next页面宿主；`npm run worker`可单独部署任务；`node server/worker.mjs --once`单次执行任务。管理后台也支持任务排队/核实。

## 页面与账号

`/`是角色化任务首页，`/apps`是参考图所需的分类密集卡片墙，支持分类、搜索、收藏、最近使用。桌面224px侧栏、64px顶栏、24px间距、最大1600px内容区；平板收为图标栏，手机显示底部导航，后台入口末位。规划卡明确标记，不计为已开发功能。

`/me/services`、`/tasks`、`/calendar`聚合本人真实源业务；私人记事工具另在/utilities，不冒充业务待办。图标为Lucide SVG并保留许可。网页为企业微信承载的H5与独立预览，原生客户端栏由企业微信提供。

登录页10类角色、18个稳定逻辑演示账号，无生产密码：

| 逻辑账号 | 兼容别名 | 角色/用途 |
|---|---|---|
| demo_admin | admin | 超管配置、授权、审计、连接健康 |
| demo_operator | operator | 门户运营、匿名汇总 |
| demo_student_01 / 02 | student / student2 | 本人业务及隔离 |
| demo_teacher_01 | teacher | 教师本人服务 |
| demo_librarian_01 / 02 | librarian / librarian2 | 授权图书范围 |
| demo_print_01 / 02 | printer / printer2 | 各自打印点 |
| demo_merchant_01 / 02 / 03 | merchant / merchant2 / merchant3 | 各自档口 |
| demo_multi_01 | multi | 教师+馆员，单活动角色 |
| demo_disabled_01 | disabled | 停用，登录拒绝 |
| demo_unassigned_01 | unassigned | 无角色，待授权 |
| demo_agent_01 | agent | 服务专员，指定服务 |
| demo_resource_01 | resource-manager | 资源管理员，指定服务 |
| demo_reviewer_01 | reviewer | 部门审核员，指定服务 |

会话8小时，多会话独立，角色权限不求并集；禁用/角色撤销/scope变更下一请求生效。超管/运营没有默认敏感业务万能处理权，B演示使用后三岗位，目前主要SERVICE范围。完整边界见 [PERMISSIONS.md](PERMISSIONS.md)。

演示：学生预约图书，馆员确认待取/领取/归还；学生上传PDF、获得10分钟报价并下单，打印员接单/处理/待取、付款确认/核销；学生选今天或明天餐段下单，商户备餐/待取/核销，学生提交订单反馈。凭证仅本人待取订单可见。付款为线下人工记录或模拟，未接真实支付。

## 数据与恢复

SQLite与PDF位于storage，PDF走鉴权下载。核心用户/组织/会话、门户、图书、打印、餐饮、通知/任务/审计/幂等/付款已独立typed迁移；报价/凭证/指南/打印规则/反馈/outbox/连接治理有独立表。旧核心迁移archive保留恢复证据。

校园/扩展/工具B域仍为legacy JSON records，不满足v3全域关系模型。每商品仅一个默认规格；规则执行器目前只支持打印费率。见 [DATA_DICTIONARY.md](DATA_DICTIONARY.md)、[IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md)。

演示凭证密钥为DB目录的.demo-credential-key，须随库备份；生产必须安全配置CREDENTIAL_ENCRYPTION_KEY为32字节hex或base64，不得写入仓库/聊天。.env.example仅基础本地配置，不是完整生产模板。APP_MODE=production拒绝演示登录/未接真实认证业务，当前不能仅改变量上线。

备份/恢复前停Web与worker，复制整个storage及实际DB目录和密钥；SQLite运行中不能只复制主库遗漏WAL。需重置时先停服务并备份：

```powershell
npm run demo:reset -- --confirm=RESET_DEMO
```

此操作删除演示数据并重新seed，拒绝production与storage外数据库。测试强制DB_PATH隔离；曾一次导入顺序误写默认演示库，现已备份/精准清理并增加开库前防护，见TEST_REPORT；物理测试PDF存储仍未全部隔离。

## 企业微信与剩余边界

连接配置支持DEMO/MANUAL/TEST/LIVE，但测试只验证本地配置，明确connected=false。企业微信、统一身份、图书馆、设备、真实支付和教学平台均未真实接通。

正式接入需学校管理员创建/授权自建应用，提供CorpID/AgentID、可见范围、正式HTTPS域名、可信域名/可信IP、成员映射，并安全配置Secret。不得把密钥写入仓库、Notion或聊天。测试企业/沙箱账号可用性需在届时官方后台验证，未宣称“虚拟企业微信”已可上线。

全部80项/全部按钮、24h幂等TTL、更多迁移故障、生产备份恢复及容量未验收，不作5000人并发或会话结束后持续开发承诺。

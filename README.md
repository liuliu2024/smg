# 校园服务平台

云栖职业技术学院（演示名称）的本地校园服务平台。包含门户、移动页面、管理后台及图书、打印、食堂业务。仅使用虚构身份，不产生真实收费或外部通知。

## 启动

要求 Node.js 24 LTS、npm。首次执行：

```powershell
npm ci
npm run dev
```

浏览器打开 http://localhost:3000 。命令同时启动 Next.js Web 和每60秒运行的数据库任务 worker。使用 localhost，不要改用127.0.0.1（修改请求需要匹配Origin）。如改端口，同时配置PORT与APP_ORIGIN。可复制.env.example为.env；启动脚本使用Node24加载该文件，进程已有环境变量优先。

首次导入服务端会创建 storage/campus.db 和幂等演示数据；不会在每次启动清空数据库。SQLite迁移以 CREATE TABLE IF NOT EXISTS 执行，当前为通用JSON记录模型，非规格要求的Prisma关系迁移。

正式构建和本地预览：

```powershell
npm run build
npm start
```

直接运行轻量HTTP服务：npm run start:standalone。独立任务：npm run worker；单次任务：node server/worker.mjs --once。管理后台也可运行一次任务。生产模式APP_MODE=production会拒绝演示登录和业务操作，真实认证尚未接入。

## 演示身份

登录页选身份，不需要密码。student/林知夏、student2/周予安、librarian/图书馆员、printer/打印操作员、merchant/食堂商户、admin/超级管理员、operator/校园运营。printer2与merchant2用于业务范围隔离验收。以登录页实际精选列表为准。

图书：学生预约，馆员确认待取、领取和归还。打印：下载页面内置PDF样例，上传、报价、提交；打印员接单、处理、待取、确认到店付款、输入本人凭证核销。食堂：选择下一开放时段下单；商户接单、备餐、待取、确认付款和核销。凭证仅订单本人在READY状态可见。

## 检查

```powershell
npm test
npm run build
npm run test:ui
```

test:ui要求本机Chrome及已启动的localhost:3000服务；截图输出到工作区outputs/screenshots（脚本可按使用位置调整）。HTTP测试使用临时数据库；不会清空演示库。真实执行结果见TEST_REPORT.md，审查见QC_REPORT.md。

## 数据与恢复

数据和PDF在storage，文件不通过静态目录提供。备份前停止Web与worker，将整个storage目录复制到安全位置；恢复时同样停止服务后替换目录。SQLite WAL运行中不可只复制主db文件。重置必须停止Web和worker并备份，然后显式执行node server/reset-demo.mjs --confirm=RESET_DEMO；拒绝production和storage目录外数据库。

## 限制

本版是可运行演示，不能视为全部P0验收通过。技术栈、页面和数据模型差异见IMPLEMENTATION_NOTES.md与QC_REPORT.md。真实身份、企微、图书馆、打印设备、支付、恶意文件扫描、生产容量验证均未接入或未执行。不可用于5000人生产并发承诺。未部署公网。

## 企业微信承载与参考图

主入口按用户提供的企业微信工作台截图实现：约134px网页导航、90px顶部区域、八列紧凑卡片、分类/搜索/收藏。网页导航是独立预览的演示导航；企业微信客户端原生栏由企业微信提供。图标使用Lucide官方SVG并附许可证，未复制第三方应用品牌标识。

真实企业微信接入需要学校提供企业ID、应用AgentID、经批准的回调域名与应用可见范围、成员标识映射，以及通过安全渠道配置的应用密钥。不要把密钥写进仓库、Notion或聊天。当前入口明确返回未接入，不模拟OAuth成功。

重置演示：先停止Web与worker并备份storage，再执行 node server/reset-demo.mjs --confirm=RESET_DEMO。production和storage目录之外的数据库会拒绝重置。

浏览器验收脚本默认保存artifacts/screenshots，支持SCREENSHOT_DIR指定路径；需要Chrome及已启动服务。首次浏览器截图旧版为门户，新版企业微信工作台检查以design-qa.md为准。


## 新增可用服务

在既有图书、打印、食堂基础上，新增校园报修、场地预约、失物招领、活动报名、意见反馈、证明申请、校园二手、校园办事八个持久化闭环。运营/超管可在后台处理工单、审核本地申请、维护场地与活动；申请人只访问本人私有记录。公开失物和二手信息采用昵称，认领说明仅相关人可见。

校园办事整合10种申请，活动整合校园活动/志愿服务/竞赛报名；同类入口归并为别名，不重复实现。所有审批均为本地演示，不代表学校正式证明、教务决定或财务审批。

公开目录约150项（当前154项），其中13项可用；首页默认可用服务，可切换全部/待接入。左侧12类导航，首页支持同义词快速过滤与回车全局搜索（应用/公告/图书/菜品）。未接入外部系统的目录不会伪装可用。

当前全量自动化66项通过，详见TEST_REPORT。内嵌浏览器不支持原生prompt，现已替换为页面内异步对话框。


## 最新演示范围

当前31个可用入口，包含新增住宿床位、学生请销假、包裹领取、设备借用、校园招聘、问卷，以及12个个人/校园信息工具。首页默认显示80张精选卡，可展开完整目录（当前170项）；规划目录仍清楚标示。

需求工程师H的FEATURE_MATRIX.md列出85项可验收操作能力，区别于31独立入口。独立需求与研究见REQUIREMENTS.md、RESEARCH_NOTES.md；UI优化与实测见UI_REPORT.md。最新服务/HTTP自动化80项通过，部分浏览器流程另有真实记录。

企业微信建议采用内部自建网页应用，但尚未取得企业参数或完成真实部署；虚拟企业/独立沙箱资格未核实。明早申请准备清单与官方资料访问限制已写RESEARCH_NOTES.md。

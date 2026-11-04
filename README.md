# 校园服务平台

云栖职业技术学院（演示名称）的本地校园服务平台。包含门户、移动页面、管理后台及图书、打印、食堂业务。仅使用虚构身份，不产生真实收费或外部通知。

## 启动

要求 Node.js 24 LTS、npm。首次执行：

```powershell
npm ci
npm run dev
```

浏览器打开 http://localhost:3000 。命令同时启动 Next.js Web 和每60秒运行的数据库任务 worker。使用 localhost，不要改用127.0.0.1（修改请求需要匹配Origin）。如改端口，同时配置PORT与APP_ORIGIN。复制.env.example仅供参考；本项目读取进程环境变量，未自动加载.env文件。

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

数据和PDF在storage，文件不通过静态目录提供。备份前停止Web与worker，将整个storage目录复制到安全位置；恢复时同样停止服务后替换目录。SQLite WAL运行中不可只复制主db文件。当前未提供reset-demo脚本，重置必须停止服务并人工确认后备份、移走storage目录再启动；不可对生产数据使用。

## 限制

本版是可运行演示，不能视为全部P0验收通过。技术栈、页面和数据模型差异见IMPLEMENTATION_NOTES.md与QC_REPORT.md。真实身份、企微、图书馆、打印设备、支付、恶意文件扫描、生产容量验证均未接入或未执行。不可用于5000人生产并发承诺。未部署公网。

## 企业微信承载与参考图

主入口按用户提供的企业微信工作台截图实现：约134px网页导航、90px顶部区域、八列紧凑卡片、分类/搜索/收藏。网页导航是独立预览的演示导航；企业微信客户端原生栏由企业微信提供。图标使用Lucide官方SVG并附许可证，未复制第三方应用品牌标识。

真实企业微信接入需要学校提供企业ID、应用AgentID、经批准的回调域名与应用可见范围、成员标识映射，以及通过安全渠道配置的应用密钥。不要把密钥写进仓库、Notion或聊天。当前入口明确返回未接入，不模拟OAuth成功。

重置演示：先停止Web与worker并备份storage，再执行 node server/reset-demo.mjs --confirm=RESET_DEMO。production和storage目录之外的数据库会拒绝重置。

浏览器验收脚本默认保存artifacts/screenshots，支持SCREENSHOT_DIR指定路径；需要Chrome及已启动服务。首次浏览器截图旧版为门户，新版企业微信工作台检查以design-qa.md为准。

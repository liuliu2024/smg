# v3 API合同

## 当前实现映射（与下方目标合同分开）

已接入的 v3 实现入口为 server/main.mjs + auth-v3/printing-v3/dining-v3/projections-v3/catalog-v3/events-v3/analytics-v3/governance-v3。所有下表仍为目标端点，不能据列出路径宣称已实现。

- 已实现：POST /auth/demo-login 接受 {code} 或兼容 {userId}；GET /auth/me、POST /auth/role、/auth/logout；8h session与活动身份。没有完整独立session管理API。
- GET /home、/apps、/search，GET /me/services、/tasks、/admin/tasks、/calendar。当前 projections 的服务/待办分页结果为 data:{records,meta}，部分业务列表采用顶层 meta，统一响应形状仍待收口。
- POST /printing/quotes：兼容规范 color/duplex 字符枚举，也接受既有 colorMode:BW|COLOR 和布尔duplex；仅A4。POST /printing/orders 强制Idempotency-Key和quoteId，paymentMode支持OFFLINE/SIMULATED，缺省OFFLINE。GET /printing/orders/:id/credential；POST /admin/printing/redeem {token}；旧订单动作兼容路径继续存在，不代表所有通用action已清除。
- POST/GET /dining/orders/:id/feedback；GET /admin/dining/feedback；POST /admin/feedback/:id/reply|resolve {body,version?}；GET /admin/dining/feedback/summary 仅匿名分类汇总。
- GET/POST /admin/guides、PATCH /admin/guides/:id、GET /admin/guides/:id（含versions）、POST /admin/guides/:id/publish；公开 /guides。规则入口 /admin/rules 目前只有 PRINT_PRICE 执行器，版本/diff/publish在 catalog-v3。
- /admin/connections 及 /admin/integrations/:id/test 记录模式与本地配置校验，connected=false；不是真实外部连通性测试。
- GET /admin/events、/admin/jobs；POST /admin/jobs/:id/retry|resolve。UNKNOWN必须先给resolution和reason核实，retry只排队。
- GET /analytics 与 /admin/analytics：range=7|30，领域白名单，拒绝userId；GET /admin/system/health、/admin/feature-flags 与公共 /health。

共享Idempotency24h语义为合同，当前创建幂等/冲突已测，24hTTL没有独立验收；不得将写入expiresAt等同过期重放全正确。错误requestId与X-Request-Id一致已有负例，422 fieldErrors目前常为form级，不等于全部字段逐项错误实现。C认证/企微/设备未接入返回未接状态，不伪造成功。

来源docs/v3/SPEC_V3.txt。下表为目标合同，不表示当前全部实现；当前缺口见V3_FEATURE_STATUS.md。所有路径加/api/v1；页面/login不充当后端认证API。

## 统一规则

成功{data,meta?}；分页meta:{page,pageSize,total}，默认20/最大100；状态/关键词/时间筛选，默认createdAt desc。错误{error:{code,message,fieldErrors?,requestId}}；401/403/404/409/422/429/503按规格。GET无写入副作用。create POST，编辑PATCH，角色/范围PUT；有历史配置禁硬删。状态动作显式独立POST路径，不能任意PATCH status或通用action字符串绕白名单。

关键创建强制Idempotency-Key；同用户/操作/key和requestHash事务内查写；有效24h重放，异内容409，缺/非法key422。所有领域另有长期唯一约束。状态动作必须验证活动角色、scope、归属、源状态、version并记录审计和事务通知/outbox。

POST /auth/demo-login {userId}仅demo；POST /auth/logout；GET /auth/me；POST /auth/role {role}。Session8小时，Cookie HttpOnly/SameSite=Lax/生产Secure。无角色auth/me可读本人待授权摘要，业务403，前端/access-pending。

登录20次/分钟/IP，上传10次/分钟/用户，核销30次/分钟/操作员；超限429。仅demo单进程限流不等同生产多实例。

## M1打印请求形状

POST /printing/quotes {fileId,pointId,color:BLACK_WHITE|COLOR,duplex:SINGLE|DOUBLE,pages,copies,binding}；服务端解析、保存PrintQuote，expiresAt=10分钟，返回费用分项、每份张数与总张数。POST /printing/orders {quoteId,paymentMode:OFFLINE|SIMULATED}，不接受客户端可信金额；报价本人、文件存续、点位接单、规则版本、有效期、幂等、订单创建必须一致。

GET /printing/orders/:id/credential仅本人有效READY返回受控凭证。POST /admin/printing/redeem {token}按hash定位并验证点位/付款/READY，事务仅成功一次。餐饮对应POST /admin/dining/redeem。凭证明文不得进入列表、运营详情或审计。

## F01—F80最小端点

| F编号 | 功能 | 目标API |
|---|---|---|
| F01 | 角色化校园首页 | GET /home。 |
| F02 | 分类应用中心 | GET /apps；POST/PATCH /admin/apps；PUT/DELETE /apps/:id/favorite。 |
| F03 | 跨模块全局搜索 | GET /search?q=。 |
| F04 | 我的服务中心 | GET /me/services。 |
| F05 | 我的待办中心 | GET /tasks；GET /admin/tasks。 |
| F06 | 校园通知中心 | GET /notifications；POST /notifications/:id/read、/notifications/read-all。 |
| F07 | 服务日历 | GET /calendar?start=&end=。 |
| F08 | 校园服务地图 | GET /locations；POST/PATCH /admin/locations。 |
| F09 | 图书检索与馆藏查询 | GET /library/books、/library/books/:id；POST/PATCH /admin/library/books。 |
| F10 | 图书预约与领取 | POST /library/reservations；POST /library/reservations/:id/cancel；POST /admin/library/reservations/:id/ready、reject、fulfill。 |
| F11 | 借阅与续借服务 | GET /library/loans；POST /library/loans/:id/renew；POST /admin/library/loans/:id/return。 |
| F12 | 自习座位预约 | GET /spaces/seats；POST /bookings；POST /bookings/:id/check-in、cancel。 |
| F13 | 研讨室预约 | GET /spaces/rooms；POST /room-bookings；POST /admin/room-bookings/:id/approve、reject。 |
| F14 | 学习空间候补 | POST /waitlists；POST /waitlists/:id/confirm、cancel。 |
| F15 | 图书荐购 | POST/GET /library/recommendations；POST /admin/library/recommendations/:id/review。 |
| F16 | 数字资源服务导航 | GET /digital-resources；POST/PATCH /admin/digital-resources。 |
| F17 | 在线文件提交 | POST /files；GET /files/:id/download。 |
| F18 | 打印参数与透明报价 | POST /printing/quotes；POST /admin/printing/prices。 |
| F19 | 打印订单履约 | POST /printing/orders；GET /printing/orders、/:id；POST /admin/printing/orders/:id/accept、start、ready、exception、resolve、reject。 |
| F20 | 取件凭证与核销 | GET /printing/orders/:id/credential；POST /admin/printing/redeem。 |
| F21 | 文印预约服务 | POST/GET /printing/appointments；POST /admin/printing/appointments/:id/quote、accept、complete。 |
| F22 | 打印点负载展示 | GET /printing/points；PATCH /admin/printing/points/:id。 |
| F23 | 打印售后处理 | POST /printing/orders/:id/after-sales；POST /admin/printing/after-sales/:id/reply、resolve。 |
| F24 | 自助打印设备接入 | POST /admin/device-tasks；GET /admin/device-tasks/:id；POST /admin/device-tasks/:id/reconcile。 |
| F25 | 食堂档口服务目录 | GET /dining/halls、/dining/stalls；POST/PATCH /admin/dining/stalls。 |
| F26 | 每日菜单与售罄管理 | GET /dining/stalls/:id/menu；POST/PATCH /admin/dining/products、inventory。 |
| F27 | 分时段餐品预订 | POST /dining/orders；GET /dining/orders、/:id；POST /dining/orders/:id/cancel。 |
| F28 | 备餐与取餐核销 | POST /admin/dining/orders/:id/accept、reject、prepare、ready、confirm-payment；POST /admin/dining/redeem。 |
| F29 | 餐饮问题反馈 | POST /dining/orders/:id/feedback；POST /admin/feedback/:id/reply、resolve。 |
| F30 | 错峰取餐容量管理 | GET /dining/stalls/:id/slots；PATCH /admin/dining/slot-capacities。 |
| F31 | 团体订餐申请 | POST /dining/group-orders；POST /admin/dining/group-orders/:id/quote、accept、complete。 |
| F32 | 配料与饮食提示 | GET /dining/products/:id；PATCH /admin/dining/products/:id/ingredients。 |
| F33 | 校园报修 | POST/GET /repairs；POST /admin/repairs/:id/assign、start、finish；POST /repairs/:id/confirm、reopen。 |
| F34 | 后勤服务预约 | POST/GET /logistics/appointments；POST /admin/logistics/appointments/:id/confirm、reject、complete。 |
| F35 | 宿舍公共问题反馈 | POST/GET /dorm/issues；POST /admin/dorm/issues/:id/assign、reply、resolve。 |
| F36 | 饮水与洗衣服务目录 | GET /facilities；POST /facilities/:id/faults；PATCH /admin/facilities/:id。 |
| F37 | 校车时刻与乘车预约 | GET /shuttle/trips；POST /shuttle/bookings；POST /shuttle/bookings/:id/cancel；POST /admin/shuttle/check-in。 |
| F38 | 快递服务导航 | GET /express/points；POST /express/issues；PATCH /admin/express/points/:id。 |
| F39 | 失物招领 | POST/GET /lost-found；POST /lost-found/:id/claims；POST /admin/lost-found/:id/review、handover。 |
| F40 | 校园建议与投诉 | POST/GET /feedback；POST /admin/feedback/:id/assign、reply、resolve。 |
| F41 | 体育场馆预约 | GET /venues；POST /venue-bookings；POST /venue-bookings/:id/cancel、check-in。 |
| F42 | 会议室预约 | GET /meeting-rooms；POST /meeting-bookings；POST /admin/meeting-bookings/:id/approve、reject。 |
| F43 | 实训室使用申请 | POST/GET /lab-applications；POST /admin/lab-applications/:id/review、close。 |
| F44 | 公共设备借用 | GET /equipment；POST /equipment-loans；POST /admin/equipment-loans/:id/approve、checkout、return。 |
| F45 | 校园活动报名 | GET /activities；POST /activities/:id/register；POST /activities/:id/cancel-registration。 |
| F46 | 活动签到与参与记录 | POST /activities/:id/check-in；POST /admin/activities/:id/check-ins/redeem。 |
| F47 | 预约候补与自动释放 | POST /booking-waitlists；POST /booking-waitlists/:id/confirm、cancel。 |
| F48 | 爽约记录与申诉 | GET /no-shows；POST /no-shows/:id/appeals；POST /admin/appeals/:id/review。 |
| F49 | 办事指南库 | GET /guides、/:id；POST/PATCH /admin/guides；POST /admin/guides/:id/publish。 |
| F50 | 在线申请表单 | GET /services/:code/form；PUT /application-drafts/:id；POST /applications。 |
| F51 | 服务申请流转 | GET /applications、/:id；POST /admin/applications/:id/accept、approve、reject、return。 |
| F52 | 材料清单与补正 | POST /admin/applications/:id/request-supplement；POST /applications/:id/resubmit。 |
| F53 | 办事窗口预约 | GET /service-windows；POST /window-appointments；POST /admin/window-appointments/:id/check-in、complete。 |
| F54 | 办件进度查询 | GET /applications/:id/timeline。 |
| F55 | 证明开具申请 | POST/GET /certificate-requests；POST /admin/certificate-requests/:id/review、issue-demo。 |
| F56 | 一件事组合服务 | GET /journeys；POST /journeys/:id/start；GET /journey-instances/:id。 |
| F57 | 个人课表 | GET /timetable；POST /admin/teaching/sync。 |
| F58 | 课程资料与教学入口 | GET /courses、/:id；POST /courses/:id/materials。 |
| F59 | 教学群关联 | GET /courses/:id/group；POST /admin/teaching/groups/bind、create-request。 |
| F60 | 直播预约与进入 | POST /courses/:id/sessions/:sessionId/live-request；GET /courses/:id/sessions/:sessionId/live。 |
| F61 | 课堂签到 | POST /sessions/:id/attendance-tasks；POST /attendance-tasks/:id/check-in；POST /attendance-records/:id/correction。 |
| F62 | 教师答疑预约 | GET /consultations/slots；POST /consultation-bookings；POST /consultation-bookings/:id/cancel。 |
| F63 | 校园讲座报名 | GET /lectures；POST /lectures/:id/register、waitlist。 |
| F64 | 实习服务指引与申请 | GET /internship-guides；POST /internship-applications；POST /admin/internship-applications/:id/review。 |
| F65 | 用户与组织管理 | GET/POST/PATCH /admin/users；GET/POST/PATCH /admin/organizations。 |
| F66 | 角色与业务范围管理 | GET/POST/PATCH /admin/roles；PUT /admin/users/:id/roles、scopes。 |
| F67 | 应用与服务目录管理 | GET/POST/PATCH /admin/services、apps。 |
| F68 | 公告与门户内容管理 | GET /announcements；POST/PATCH /admin/content；POST /admin/content/:id/publish。 |
| F69 | 服务规则配置 | GET/POST /admin/rules；POST /admin/rules/:id/publish。 |
| F70 | 综合受理与转派 | GET /requests；POST /admin/service-cases/:id/assign、reply、resolve。 |
| F71 | 服务质量与超时管理 | GET /admin/service-quality；POST /admin/cases/:id/escalate。 |
| F72 | 操作审计与敏感访问 | GET /admin/audit。 |
| F73 | 学校统一身份接入 | GET /auth/sso/start、/auth/sso/callback；POST /admin/integrations/sso/test。 |
| F74 | 企业微信集成 | GET /auth/wecom/start、/auth/wecom/callback；POST /admin/integrations/wecom/test。 |
| F75 | 外部系统连接管理 | GET/POST/PATCH /admin/integrations；POST /admin/integrations/:id/test。 |
| F76 | 任务与事件中心 | GET /admin/jobs；POST /admin/jobs/:id/retry；POST /admin/jobs/run-once。 |
| F77 | 服务运营分析 | GET /admin/analytics?range=&domain=。 |
| F78 | 办事知识助手 | POST /assistant/answer；GET /admin/knowledge。 |
| F79 | 智能服务导航 | POST /service-navigation。 |
| F80 | 环境发布与健康检查 | GET /health；GET /admin/system/health；PATCH /admin/feature-flags。 |

## 当前兼容差距

旧main.mjs使用POST配置编辑、/me/loans、/admin/jobs/run及/services/:module/.../action等与v3不同。迁移可暂保旧客户端兼容，但规范路径和同一领域service必须共享；旧API不可绕过新权限、强幂等、报价或scope。旧payload内meta仅用于兼容，规范新端点按顶层meta。

## 测试合同

每F生成T-Fxx-01正向、02权限、03异常；具体输入/边界见原规格及V3_FEATURE_STATUS。接口只有503占位不构成C本地合同交付，仍需provider/config状态、适配签名、错误和DEMO可验证路径。任何测试未真实运行都标未执行。

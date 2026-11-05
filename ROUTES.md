# v3路由合同

## 当前可运行路由与别名

当前 / 为 personalHome 任务首页，/apps 为密集分类卡片墙，两者已分离；/home不是另一个页面主入口，GET /api/v1/home 是首页数据。/tasks、/calendar、/me/services、/notifications、/search、/access-pending 已有前端分支。

/admin/service-desk、/admin/resources、/admin/applications 当前落到范围待办页；它们不是已完成综合受理、实体资源和版本申请中心。/admin/guides 提供版本编辑发布；/admin/rules 为打印费率规则；连接/任务/分析/健康页面以 public/app.js 实际分支为准。下表列出的其他规范路径仍可能是待实现目标，不能仅凭通用catch-all页面存在视为业务完成。

旧 /services/:module、/extensions/:module、/utilities/:module 保留演示兼容。B详情深链接仍指向这些旧域，不宣称所有规范路由已重定向。UI有效样式最后覆盖为桌面224px侧栏/64px顶栏/24px间距/max1600；768~1023侧栏收为64px图标，手机隐藏侧栏显示底部导航。完整逐按钮/所有深链接刷新仍待验收。

来源完整规格，目标路径固定，F编号不因页面调整变化。此表是路由清单而非已实现声明。详情可刷新和深链接；不只依赖不可恢复弹窗。列表未显式详情的业务默认同域/[id]，实际确定后在本文件追加。权限菜单来自服务端，不能依赖前端隐藏。

公共：/login、/access-pending、/403、404页、/health。规范后台路径均/admin前缀。

| F编号 | 页面 | 后台 |
|---|---|---|
| F01 | /。 | /admin/dashboard |
| F02 | /apps。 | /admin/apps |
| F03 | /search。 | /admin/search-settings |
| F04 | /me/services。 | 各业务后台 |
| F05 | /tasks。 | /admin/tasks |
| F06 | /notifications。 | /admin/messages |
| F07 | /calendar。 | 规则由各业务后台管理 |
| F08 | /map。 | /admin/service-locations |
| F09 | /library、/library/books/:id。 | /admin/library/books、/copies |
| F10 | /library/reservations。 | /admin/library/reservations |
| F11 | /library/loans。 | /admin/library/loans |
| F12 | /spaces/seats。 | /admin/spaces/seats |
| F13 | /spaces/rooms。 | /admin/spaces/rooms |
| F14 | /spaces/waitlist。 | /admin/spaces/waitlist |
| F15 | /library/recommendations。 | /admin/library/recommendations |
| F16 | /library/digital。 | /admin/library/digital-resources |
| F17 | /printing/new。 | /admin/printing/orders/:id |
| F18 | /printing/new。 | /admin/printing/prices |
| F19 | /printing/orders、/printing/orders/:id。 | /admin/printing/orders |
| F20 | /printing/orders/:id。 | /admin/printing/redeem |
| F21 | /printing/appointments。 | /admin/printing/appointments |
| F22 | /printing。 | /admin/printing/points |
| F23 | /printing/orders/:id/after-sales。 | /admin/printing/after-sales |
| F24 | 订单设备状态区。 | /admin/integrations/printing |
| F25 | /dining。 | /admin/dining/halls、stalls |
| F26 | /dining/stalls/:id。 | /admin/dining/products、inventory |
| F27 | /dining/checkout。 | /admin/dining/orders |
| F28 | /dining/orders/:id。 | /admin/dining/orders |
| F29 | /dining/orders/:id/feedback。 | /admin/dining/feedback |
| F30 | 档口时段选择区。 | /admin/dining/capacity |
| F31 | /dining/group-orders。 | /admin/dining/group-orders |
| F32 | 菜品详情。 | /admin/dining/products/:id |
| F33 | /repairs。 | /admin/repairs |
| F34 | /logistics/appointments。 | /admin/logistics/appointments |
| F35 | /dorm/issues。 | /admin/dorm/issues |
| F36 | /life/facilities。 | /admin/life/facilities |
| F37 | /shuttle。 | /admin/shuttle |
| F38 | /express。 | /admin/express |
| F39 | /lost-found。 | /admin/lost-found |
| F40 | /feedback。 | /admin/feedback |
| F41 | /venues。 | /admin/venues |
| F42 | /meeting-rooms。 | /admin/meeting-rooms |
| F43 | /training-rooms。 | /admin/training-rooms |
| F44 | /equipment。 | /admin/equipment |
| F45 | /activities。 | /admin/activities |
| F46 | /activities/:id/check-in。 | /admin/activities/:id/check-in |
| F47 | /bookings/waitlist。 | /admin/bookings/waitlists |
| F48 | /bookings/appeals。 | /admin/no-shows |
| F49 | /guides。 | /admin/guides |
| F50 | /services/:code/apply。 | /admin/forms |
| F51 | /applications。 | /admin/applications |
| F52 | /applications/:id/materials。 | /admin/applications/:id |
| F53 | /service-windows。 | /admin/service-windows |
| F54 | /applications/:id。 | /admin/applications/:id |
| F55 | /certificates。 | /admin/certificates |
| F56 | /journeys。 | /admin/journeys |
| F57 | /timetable。 | /admin/teaching/sync |
| F58 | /courses、/courses/:id。 | /admin/teaching/courses |
| F59 | /courses/:id/group。 | /admin/teaching/groups |
| F60 | /courses/:id/sessions/:sessionId。 | /admin/teaching/livestreams |
| F61 | /courses/:id/sessions/:sessionId/attendance。 | /admin/teaching/attendance |
| F62 | /consultations。 | /admin/consultations |
| F63 | /lectures。 | /admin/lectures |
| F64 | /internships。 | /admin/internships |
| F65 | /me只读。 | /admin/users、organizations |
| F66 | 无个人编辑入口。 | /admin/roles、scopes |
| F67 | /apps。 | /admin/apps、services |
| F68 | /announcements/:id。 | /admin/content、banners |
| F69 | 服务规则说明。 | /admin/rules |
| F70 | /requests。 | /admin/service-desk |
| F71 | 申请详情显示承诺时限。 | /admin/service-quality |
| F72 | 无。 | /admin/audit |
| F73 | /login。 | /admin/integrations/sso |
| F74 | /auth/wecom/start及应用入口。 | /admin/integrations/wecom |
| F75 | 服务详情接入标签。 | /admin/integrations |
| F76 | 无。 | /admin/jobs、events |
| F77 | 个人仅本人摘要。 | /admin/analytics |
| F78 | /assistant。 | /admin/knowledge |
| F79 | 全局搜索自然语言入口。 | /admin/service-intents |
| F80 | /health及环境提示。 | /admin/system |

## 旧入口迁移原则

- /services/repairs→/repairs；/services/venues→/venues；/services/lost→/lost-found；/services/activities→/activities；/services/feedback→/feedback；/services/certificates→/certificates；/utilities/guides→/guides。旧详情ID须指向同一领域记录，不能另建一套业务。
- /utilities/calendar、tasks仍为私人手工工具，不自动转成/calendar、/tasks；后两者必须是源业务投影。
- /extensions/equipment不能仅改URL称F44，需实体条码与日期模型。/extensions/parcels与住房/招聘是旧附加能力，不抵F38/F35/F64。
- 规划或未实现页面保留明确说明/禁入状态，不用200空白SPA壳作为路由验收。
- 多角色默认落点按PERMISSIONS；工作人员进入本人门户时仍能返回所选岗位后台。

## 岗位首页

STUDENT/TEACHER→/；LIBRARIAN→/admin/library/reservations；PRINT_OPERATOR→/admin/printing/orders；CANTEEN_MERCHANT→/admin/dining/orders；CAMPUS_OPERATOR/SUPER_ADMIN→/admin；SERVICE_AGENT→/admin/service-desk；RESOURCE_MANAGER→/admin/resources；DEPARTMENT_REVIEWER→/admin/applications；无角色→/access-pending。

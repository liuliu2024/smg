# v3权限与身份合同

## 当前实现与未完成边界

server/auth-v3.mjs 与 typed v3_user_roles/v3_operator_scopes 已实现10角色、18逻辑账号别名、8h多session和当前角色隔离。seed给馆员SERVICE=library，打印员PRINT_POINT，商户STALL；新三岗位给明确SERVICE列表。有效scope变更在下一请求重新读取，测试已覆盖撤销后403及恢复。

打印/餐饮/图书scope和本人授权已有回归；legacy campus/extensions已收缩为SERVICE_AGENT/RESOURCE_MANAGER/DEPARTMENT_REVIEWER，SUPER_ADMIN和CAMPUS_OPERATOR敏感B处理接口403。不要再用“运营/超管可处理全部工单”描述当前行为。超管/运营可读匿名分析、配置等授权资源。

下方部门/资源/教学班等是完整目标合同；当前B主要用SERVICE范围。虽然配置校验支持若干DEPARTMENT/CAMPUS/RESOURCE类型，不能据此宣称完整v3部门节点、实体资源、教学班授权已实现。全部岗位按钮、禁止自批和跨部门负例未逐项验收。限流为进程内demo实现，非多实例生产限流。

来源：docs/v3/SPEC_V3.txt第01/03/04/06章。此文件保留完整目标权限，并在下节区分当前实现与剩余范围。默认拒绝，不以菜单隐藏代替API授权。

## 授权公式

每次请求读取有效User+Session；身份有效→**当前活动角色**权限→typed OperatorScope→本人/对象归属→业务状态/版本。多角色不求权限并集。客户端role/userId/scope都不能成为可信身份。账号停用、角色撤销、scope变更在下一请求生效。

Session：随机token，表内仅hash，8小时；HttpOnly/SameSite=Lax、生产Secure。允许同用户多个独立session，退出只撤当前session；改角色只影响当前session。无角色activeRoleId=null，仅可读取本人待授权摘要/退出，业务403，页面/access-pending；不默认STUDENT。生产无真实认证503，demo-login404。

## 系统角色与默认落点

| 活动角色 | 允许的域 | 范围约束 | 明确不允许 | 默认首页 |
|---|---|---|---|---|
| STUDENT | 本人门户/预约/订单/申请 | userId=当前本人；公共已发布信息按受众 | 后台业务处理/他人记录/提升角色 | / |
| TEACHER | 本人服务；已分配教学/导师事务 | 本人、授课教学班/分配学生/本人答疑时段 | 任意班级/任意导师学生/自批 | / |
| LIBRARIAN | 图书与学习空间处理 | 明确图书馆/学习资源scope | 打印文件、餐饮和其他部门正文 | /admin/library/reservations |
| PRINT_OPERATOR | 打印履约、授权下载、付款确认/核销 | PRINT_POINT匹配订单pointId | 跨点正文、全局价格/角色配置 | /admin/printing/orders |
| CANTEEN_MERCHANT | 菜品库存、餐单、关联餐饮反馈和核销 | STALL匹配产品/订单/反馈来源 | 其他档口、打印正文、全局消费记录 | /admin/dining/orders |
| CAMPUS_OPERATOR | 应用、内容、指南、反馈和匿名统计 | 已授运营权限、必要部门/服务范围；源隐私仍按域 | 所有申请/证明/设备/借阅/文件的万能管理 | /admin |
| SERVICE_AGENT | 指定服务/部门工单与申请受理 | SERVICE/DEPARTMENT等明确scope | 未分配部门正文、改订单领域状态、任意审批 | /admin/service-desk |
| RESOURCE_MANAGER | 指定资源/场地/设备/活动管理 | RESOURCE/ACTIVITY及明确配置的校区资源策略 | 全校资源、审批本人申请、任意学生材料 | /admin/resources |
| DEPARTMENT_REVIEWER | 指定部门申请/证明审核 | DEPARTMENT+服务/节点权限，禁止自批 | 其他部门、非当前节点、读无关文件 | /admin/applications |
| SUPER_ADMIN | 配置/授权/集成/审计和必要非敏感运营记录 | 明确grantable权限；日志也审计 | 默认读取打印正文、私人借阅/材料/问卷个体答卷 | /admin |

工作人员均可进入本人门户；要访问业务敏感正文，应明确授相应业务角色与范围并切换当前身份。isAdmin不是正文放行条件。

## Scope合同

OperatorScope(userId,roleId,resourceType,resourceId)，四列组合唯一，目标外键存在。建议预设类型PRINT_POINT、STALL、LIBRARY、SERVICE、DEPARTMENT、RESOURCE、ACTIVITY、CAMPUS、TEACHING_CLASS；实现时在后端白名单固定，不接受任意kind映射数据库集合。角色无匹配scope时不默认为全校。

- 打印：订单pointId/文件关联订单pointId匹配PRINT_POINT；下载仅本人或范围操作员，审计记录不含正文。
- 餐饮：所有商品/库存/订单/投诉均从来源stallId验证，不信任请求自行填scope。
- 工单/申请：来源service和department逐层校验，转派不能让处理人越权改变原打印/餐饮/图书状态。
- 资源：精确resourceId/activityId；校区scope仅在后端明确允许的资源策略中展开，不自动覆盖所有校区用户资料。
- 教学：教学班成员/授课关系、导师分配独立验证，不用组织相同或姓名相同放行。
- 组织树本身不是权限授权。parentId不得自指/成环；scope不是普通配置文本。

## 18个指定逻辑演示账号

全部虚构，仅demo登录选择，不共享生产密码。稳定业务code查找seed，不用随机ID反复创建。

| 逻辑账号 | 角色 | 必须绑定的演示范围 |
|---|---|---|
| demo_admin | SUPER_ADMIN | 配置授权 |
| demo_operator | CAMPUS_OPERATOR | 门户运营 |
| demo_student_01 | STUDENT | 本人主要业务 |
| demo_student_02 | STUDENT | 本人隔离/并发 |
| demo_teacher_01 | TEACHER | 本人及已分配教学 |
| demo_librarian_01 | LIBRARIAN | 演示图书馆 |
| demo_librarian_02 | LIBRARIAN | 演示图书馆协同 |
| demo_print_01 | PRINT_OPERATOR | 东校区图文中心 |
| demo_print_02 | PRINT_OPERATOR | 西校区自助打印点 |
| demo_merchant_01 | CANTEEN_MERCHANT | 第一食堂家常菜 |
| demo_merchant_02 | CANTEEN_MERCHANT | 第一食堂面食 |
| demo_merchant_03 | CANTEEN_MERCHANT | 第二食堂轻食 |
| demo_multi_01 | TEACHER+LIBRARIAN | 按活动角色；默认TEACHER，不合并权限 |
| demo_disabled_01 | STUDENT，停用 | 登录拒绝 |
| demo_unassigned_01 | 无角色 | /access-pending，不默认学生 |
| demo_agent_01 | SERVICE_AGENT | 东校区后勤服务 |
| demo_resource_01 | RESOURCE_MANAGER | 东校区公共空间与设备 |
| demo_reviewer_01 | DEPARTMENT_REVIEWER | 学生事务演示部门 |

## 配置与权限预览

系统角色不可删除；自定义角色仅绑定预设Permission；授权必须满足调用者可授范围，不能让普通管理员授自己不拥有的高危权限。禁止停用/移除最后有效超管。角色分配与scope分配独立且审计。权限预览仅展示拟菜单/资源，不取得目标用户session或执行其动作。

## 必测拒绝矩阵

| 用例 | 行为 | 期望 |
|---|---|---|
| T-SEC-SUPER-PRIVATE | 超管直接下载本人之外打印文件/读取无关材料 | 403/404，无正文 |
| T-SEC-MULTI-ACTIVE | 多角色TEACHER活动时调用馆员API | 403；切LIBRARIAN且scope正确才可 |
| T-SEC-SCOPE-POINT/STALL | 操作员/商户跨点位读取/核销 | 403/404，无副作用 |
| T-SEC-SCOPE-DEPT | 部门审核人猜另部门申请/文件 | 403/404 |
| T-SEC-SELF-REVIEW | 教师/审核人审批本人申请 | 拒绝，不推进状态 |
| T-SEC-UNASSIGNED | 无角色登录后访问业务 | 明确待授权，不给学生默认权限 |
| T-SEC-DISABLED | 旧session用户被禁用 | 下一请求失败 |
| T-SEC-ROLE-REVOKED | 旧session活动角色被移除 | 下一请求失败；不自动切更高权限 |
| T-SEC-SESSION-8H | 时钟超过8小时 | 会话失效；不依赖客户端过期 |
| T-SEC-SESSIONS | 同用户两个session，退出其一 | 另一会话有效，活动角色彼此独立 |
| T-SEC-SCOPE-UPDATE | 正在使用的scope被移除 | 下一请求拒绝，无缓存残留 |
| T-SEC-OPERATOR-AGGREGATE | 运营读取匿名汇总后猜个体接口 | 不存在个体答卷/敏感正文返回 |

后台菜单必须与权限合同同步，但以上API拒绝矩阵是最终授权证据。H核对TEST_REPORT，旧正向夹具已改为新岗位及SERVICE scopes；测试未覆盖全部完整v3部门模型，不为旧流程放宽权限。

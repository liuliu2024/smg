# 可验收功能点矩阵

需求工程师H，2026-11-05。**当前31独立入口；下表85项操作能力；目录卡片数另计。** 表中子操作不另称独立模块。状态为“源码已见，报告含关联API/服务测试”；H未亲自运行，逐页面浏览器验收仍以主协调/UI记录为准。并非每行都有独立测试函数，部分测试按整条业务流覆盖。

证据代号：T1 tests/acceptance.test.mjs；T2 tests/extended.test.mjs；T3 tests/continuation.test.mjs；T4 tests/jobs.test.mjs（与T1等联合）；T5 tests/campus.test.mjs；T6 tests/extensions.test.mjs；T7 tests/utilities.test.mjs。关联测试不是完整浏览器验收证明；最小验收列是逐项复核标准。

## 功能点

| ID | 分组 | 实际能力 | 页面入口 | 最小流程 | 验收条件 | 证据 |
|---|---|---|---|---|---|---|
| F001 | 门户 | 演示身份登录 | `/` | 选虚构账号，建立HttpOnly session | 登录后身份匹配，production拒绝demo | T1/T3；server/main.mjs / public/app.js |
| F002 | 门户 | 本人角色切换 | `/` | 只允许已分配角色 | 未分配角色拒绝；撤销角色后旧会话失效 | T1/T3；server/main.mjs / public/app.js |
| F003 | 门户 | 功能分类和可用状态筛选 | `/` | 读取目录按类别/状态过滤 | 规划状态不执行真实业务 | T1/T3；server/main.mjs / public/app.js |
| F004 | 门户 | 名称与同义词搜索 | `/` | 首页过滤，回车全局检索 | 别名能定位真实模块，私有记录不进入全局搜索 | T1/T3；server/main.mjs / public/app.js |
| F005 | 门户 | 收藏/取消收藏 | `/` | 用户与应用绑定 | 刷新保留，其他用户不继承 | T1/T3；server/main.mjs / public/app.js |
| F006 | 门户 | 最近使用 | `/` | 打开应用保存本人历史 | 刷新仍可查询，仅本人 | T1/T3；server/main.mjs / public/app.js |
| F007 | 门户 | 消息已读/全部已读 | `/` | 修改本人通知readAt | 未读统计与动作一致 | T1/T3；server/main.mjs / public/app.js |
| F008 | 门户 | 个人服务导航 | `/` | 个人中心跳本人记录 | 入口均使用鉴权接口 | T1/T3；server/main.mjs / public/app.js |
| F009 | 图书 | 书目检索与馆藏详情 | `/library` | 查看书目与独立实体册 | 可借数按实体册计算 | T1/T4；server/services.mjs / server/main.mjs |
| F010 | 图书 | 提交图书预约 | `/library` | 幂等创建并事务占册 | 最后一册并发最多一人成功 | T1/T4；server/services.mjs / server/main.mjs |
| F011 | 图书 | 取消预约 | `/library` | 本人初始/待取预约取消 | 库存仅释放一次 | T1/T4；server/services.mjs / server/main.mjs |
| F012 | 图书 | 馆员确认待取 | `/library` | PENDING转READY | 设置48小时到期并通知 | T1/T4；server/services.mjs / server/main.mjs |
| F013 | 图书 | 馆员办理领取 | `/library` | READY转FULFILLED并建借阅 | 已过期/重复领取拒绝 | T1/T4；server/services.mjs / server/main.mjs |
| F014 | 图书 | 馆员归还入库 | `/library` | ACTIVE借阅转RETURNED | 实体册恢复可借，重复归还拒绝 | T1/T4；server/services.mjs / server/main.mjs |
| F015 | 图书 | 本人续借 | `/library` | 未逾期且未续过时延长14天 | 不满足规则拒绝 | T1/T4；server/services.mjs / server/main.mjs |
| F016 | 图书 | 预约过期清理 | `/library` | worker扫描到期READY | 释放一次并保存记录 | T1/T4；server/services.mjs / server/main.mjs |
| F017 | 打印 | 样例PDF下载 | `/printing` | 生成虚构资料PDF | 实际下载PDF，不使用真实文件 | T1/T4；server/services.mjs / server/main.mjs |
| F018 | 打印 | PDF上传与页数解析 | `/printing` | 校验签名/大小/页数 | 非PDF、20MB以上、301页拒绝 | T1/T4；server/services.mjs / server/main.mjs |
| F019 | 打印 | 打印参数与报价 | `/printing` | 服务端页码/份数/单双面/装订重新计价 | 整数分，双面每份独立向上取整 | T1/T4；server/services.mjs / server/main.mjs |
| F020 | 打印 | 提交打印订单 | `/printing` | 保存价格快照、幂等键 | 重放同键不重复创建；异内容409 | T1/T4；server/services.mjs / server/main.mjs |
| F021 | 打印 | 个人订单/文件查看 | `/printing` | 本人或对应打印点访问 | 他人订单、文件拒绝，下载审计 | T1/T4；server/services.mjs / server/main.mjs |
| F022 | 打印 | 打印接单与处理 | `/printing` | SUBMITTED→ACCEPTED→PROCESSING→READY | 非法跳转拒绝，待取通知 | T1/T4；server/services.mjs / server/main.mjs |
| F023 | 打印 | 异常处理 | `/printing` | EXCEPTION保存前态 | 原因必填，可恢复或人工取消 | T1/T4；server/services.mjs / server/main.mjs |
| F024 | 打印 | 付款确认与凭证核销 | `/printing` | 到店付款后READY一次核销 | 错码、未付款、重复核销失败 | T1/T4；server/services.mjs / server/main.mjs |
| F025 | 食堂 | 食堂/档口/在售菜品查询 | `/dining` | 选择单档口菜单 | 下架不影响历史快照 | T1/T4；server/services.mjs / server/main.mjs |
| F026 | 食堂 | 分时段下单 | `/dining` | 服务端计价并原子扣库存 | 跨档口、过期时段、库存不足拒绝 | T1/T4；server/services.mjs / server/main.mjs |
| F027 | 食堂 | 本人初始取消 | `/dining` | SUBMITTED取消 | 只恢复一次库存，备餐后不可直接取消 | T1/T4；server/services.mjs / server/main.mjs |
| F028 | 食堂 | 商户接单备餐待取 | `/dining` | ACCEPTED→PREPARING→READY | 仅所属档口可处理 | T1/T4；server/services.mjs / server/main.mjs |
| F029 | 食堂 | 收款确认和取餐核销 | `/dining` | 独立付款状态与随机凭证 | 仅READY、已付、正确码一次成功 | T1/T4；server/services.mjs / server/main.mjs |
| F030 | 食堂 | 商品/价格/时段库存维护 | `/dining` | 商户限定范围、后台版本校验 | 跨档口拒绝，旧版本409 | T1/T4；server/services.mjs / server/main.mjs |
| F031 | 校园八模块 | 报修提交与本人查询 | `/services/:module` | 描述、地点保存工单 | 他人私有记录不可见 | T5；server/campus.mjs |
| F032 | 校园八模块 | 报修运营处理与本人关闭 | `/services/:module` | 受理→处理→解决→本人关闭 | 按allowedActions操作，回复保留 | T5；server/campus.mjs |
| F033 | 校园八模块 | 场地时段预约 | `/services/:module` | 未来30天选场地/时段 | 同场地同一时段并发只一人成功 | T5；server/campus.mjs |
| F034 | 校园八模块 | 场地取消释放 | `/services/:module` | 开始前取消 | 重复取消失败，资源只释放一次 | T5；server/campus.mjs |
| F035 | 校园八模块 | 失物发布与公共浏览 | `/services/:module` | 寻物/招领信息公开，作者昵称 | 不暴露作者userId及其他认领理由 | T5；server/campus.mjs |
| F036 | 校园八模块 | 失物认领与指定归还 | `/services/:module` | 认领说明、发布者选claimId | 重复认领拒绝，归还后本人仍可查结果 | T5；server/campus.mjs |
| F037 | 校园八模块 | 活动报名/取消 | `/services/:module` | 校园、志愿、竞赛共用名额规则 | 最后名额并发保护，取消仅恢复一次 | T5；server/campus.mjs |
| F038 | 校园八模块 | 活动与场地资源配置 | `/services/:module` | 运营维护时间/容量/开关 | 已有报名不可随意改时、缩容不能低于报名数 | T5；server/campus.mjs |
| F039 | 校园八模块 | 反馈处理 | `/services/:module` | 提交→处理→解决→本人关闭 | 私有内容不进全局搜索 | T5；server/campus.mjs |
| F040 | 校园八模块 | 证明申请审核 | `/services/:module` | 在读/成绩/实习证明本地审核 | DEMO编号和非正式声明保持可见 | T5；server/campus.mjs |
| F041 | 校园八模块 | 二手发布与撤下/售出 | `/services/:module` | 整数分价格、公共信息与本人动作 | 非本人不能售出，终态不可重复操作 | T5；server/campus.mjs |
| F042 | 校园八模块 | 校园办事提交审核 | `/services/:module` | 按options允许类型提交并人工审核 | 非法类型拒绝，模拟决定声明可见 | T5；server/campus.mjs |
| F043 | 校园八模块 | 校园业务幂等与通知 | `/services/:module` | 状态变化与通知同事务 | 同键同内容重放，同键异内容409 | T5；server/campus.mjs |
| F044 | 校园八模块 | 模块禁用/角色可见控制 | `/services/:module` | 目录状态与API共同校验 | 猜测停用模块接口仍拒绝 | T5；server/campus.mjs |
| F045 | 六项扩展 | 住宿申请/取消 | `/extensions/:module` | 每人只一有效申请 | 重复提交或越权拒绝 | T6；server/extension.mjs |
| F046 | 六项扩展 | 运营分配床位 | `/extensions/:module` | 明确选可用床位并分配 | 跨进程同床位最多一人分配 | T6；server/extension.mjs |
| F047 | 六项扩展 | 退宿释放 | `/extensions/:module` | 已入住申请退宿 | 原床仅释放一次 | T6；server/extension.mjs |
| F048 | 六项扩展 | 床位资源维护 | `/extensions/:module` | 楼栋/房间/床位启停 | 重复物理床位拒绝 | T6；server/extension.mjs |
| F049 | 六项扩展 | 日期请假申请 | `/extensions/:module` | 开始/结束/原因 | 日期合法、范围限制、有效申请不重叠 | T6；server/extension.mjs |
| F050 | 六项扩展 | 请假审批与销假 | `/extensions/:module` | 运营批准/驳回，本人到期段销假 | 终态不能重操作，历史查询本人隔离 | T6；server/extension.mjs |
| F051 | 六项扩展 | 包裹入库 | `/extensions/:module` | 运营选择收件人及物流编号 | 重复物流号拒绝，普通人不能入库 | T6；server/extension.mjs |
| F052 | 六项扩展 | 本人取件凭证 | `/extensions/:module` | 仅本人待取详情显示原始码 | 列表/运营响应不泄露token | T6；server/extension.mjs |
| F053 | 六项扩展 | 包裹核销 | `/extensions/:module` | 运营提交本人提供的码 | 错码/重复领取失败 | T6；server/extension.mjs |
| F054 | 六项扩展 | 设备借用申请 | `/extensions/:module` | 数量1~5，库存事务预占 | 最后库存并发仅允许合法数量 | T6；server/extension.mjs |
| F055 | 六项扩展 | 设备出借/归还 | `/extensions/:module` | 运营出借与回收 | 归还/初始取消/拒绝仅恢复一次库存 | T6；server/extension.mjs |
| F056 | 六项扩展 | 设备资源配置 | `/extensions/:module` | 维护设备总数 | 总量不能低于占用/借出数 | T6；server/extension.mjs |
| F057 | 六项扩展 | 岗位发布/关闭 | `/extensions/:module` | 维护岗位内容与截止日期 | 已关闭或截止岗位不能投递 | T6；server/extension.mjs |
| F058 | 六项扩展 | 岗位投递/撤回 | `/extensions/:module` | 申请材料本人保存 | 重复有效投递拒绝，撤回状态保留 | T6；server/extension.mjs |
| F059 | 六项扩展 | 投递人工处理 | `/extensions/:module` | 审阅、面试、接受/拒绝 | 仅运营处理，不能猜测他人材料 | T6；server/extension.mjs |
| F060 | 六项扩展 | 问卷配置发布 | `/extensions/:module` | 题目与有效选项、开放期限 | 已作答问卷不可改题 | T6；server/extension.mjs |
| F061 | 六项扩展 | 问卷一次作答 | `/extensions/:module` | 按题完整选择 | 每人一次、幂等重放不多计 | T6；server/extension.mjs |
| F062 | 六项扩展 | 匿名汇总查询 | `/extensions/:module` | 运营只看各题选项计数 | 不提供个体答卷或参与者名单API | T6；server/extension.mjs |
| F063 | 十二工具 | 个人日程增改归档 | `/utilities/:module` | 标题、开始/结束、地点 | 时间合法，重叠冲突，数据仅本人 | T7；server/utilities.mjs |
| F064 | 十二工具 | 待办新增/完成/重开 | `/utilities/:module` | 保存截止日期与说明 | 完成和重开状态有效，数据仅本人 | T7；server/utilities.mjs |
| F065 | 十二工具 | 笔记新增/编辑/置顶/归档 | `/utilities/:module` | 文本和分类保存 | 其他用户及管理员接口均不可读 | T7；server/utilities.mjs |
| F066 | 十二工具 | 个人记账与汇总 | `/utilities/:module` | 用途/整数分/日期/分类 | 拒绝浮点，汇总只包含本人 | T7；server/utilities.mjs |
| F067 | 十二工具 | 校园通讯录查询 | `/utilities/:module` | 已发布部门位置/公开联系方式 | 草稿不可见，支持关键词查询 | T7；server/utilities.mjs |
| F068 | 十二工具 | 校园地点查询 | `/utilities/:module` | 校区/位置/到达指引 | 仅公开演示信息，不宣称真实地图导航 | T7；server/utilities.mjs |
| F069 | 十二工具 | 校车时刻查询 | `/utilities/:module` | 线路/站点/发车时刻 | 格式校验，运营维护，不宣称实时定位 | T7；server/utilities.mjs |
| F070 | 十二工具 | 开放时间查询 | `/utilities/:module` | 地点/时段/节假日说明 | 草稿撤回后普通人不可见 | T7；server/utilities.mjs |
| F071 | 十二工具 | 办事指南查询 | `/utilities/:module` | 材料、步骤、地点 | 公开发布后可检索，非正式校务决定 | T7；server/utilities.mjs |
| F072 | 十二工具 | 资料文本下载 | `/utilities/:module` | 按鉴权接口导出已发布正文 | 返回实际txt及演示标识，撤回后拒绝 | T7；server/utilities.mjs |
| F073 | 十二工具 | 常见问题查询 | `/utilities/:module` | 问题/分类/答复 | 按关键词检索，运营可维护 | T7；server/utilities.mjs |
| F074 | 十二工具 | 校园校历查询 | `/utilities/:module` | 事项、开始结束及说明 | 结束晚于开始，全部为明确演示校历 | T7；server/utilities.mjs |
| F075 | 十二工具 | 八类公共内容发布撤回 | `/utilities/:module` | 运营创建DRAFT、发布/撤回 | 普通人不能维护，撤回立即不可见 | T7；server/utilities.mjs |
| F076 | 十二工具 | 工具版本/幂等/分页 | `/utilities/:module` | 提交版本和幂等键；20条分页 | 旧版本409，同键冲突409，21条跨页不丢 | T7；server/utilities.mjs |
| F077 | 运营基础 | 应用/分类维护 | `/admin` | 上架、维护、规划、停用及分类 | 状态白名单、恶意URL拒绝 | T2/T3/T4；server/configuration.mjs / server/main.mjs |
| F078 | 运营基础 | 公告/轮播发布 | `/admin` | 草稿、目标角色、有效期、排序 | 未发布或无目标角色不泄露 | T2/T3/T4；server/configuration.mjs / server/main.mjs |
| F079 | 运营基础 | 用户启停 | `/admin` | 修改状态 | 旧session立即失效，最后管理员保护 | T2/T3/T4；server/configuration.mjs / server/main.mjs |
| F080 | 运营基础 | 角色/范围授权 | `/admin` | 超管分配角色和打印点/档口范围 | 普通人不可授权，移除活动角色使session失效 | T2/T3/T4；server/configuration.mjs / server/main.mjs |
| F081 | 运营基础 | 通用后台分页筛选排序 | `/admin` | 默认20、上限100、meta总数 | 非法分页422，真实全库筛选 | T2/T3/T4；server/configuration.mjs / server/main.mjs |
| F082 | 运营基础 | 周期任务领取和重试 | `/admin` | 数据库锁、过期锁回收、最多三次 | 第三次失败停止自动领取 | T2/T3/T4；server/configuration.mjs / server/main.mjs |
| F083 | 运营基础 | 到期文件清理 | `/admin` | 只删除到期文件并保留订单 | 未到期文件保留，失败可重试 | T2/T3/T4；server/configuration.mjs / server/main.mjs |
| F084 | 运营基础 | 审计和集成状态 | `/admin` | 记录敏感动作，显示未接入provider | 不记录完整token/正文/密钥 | T2/T3/T4；server/configuration.mjs / server/main.mjs |
| F085 | 运营基础 | 演示安全重置 | `/admin` | 精确确认，仅storage内演示库 | 无确认、production、外路径均拒绝 | T2/T3/T4；server/configuration.mjs / server/main.mjs |

## 必须保留的差距

- P1企微OAuth/学校SSO、真实图书馆、设备、支付未接入，不在已完成功能数量内。
- 默认TypeScript/Prisma关系架构未完成；JSON记录模型和SQLite演示不证明学校生产容量。
- 公开校车、地点、校历、通讯录均虚构种子；支持维护/检索属于已实现能力，数据真实性另需学校确认。
- 问卷是API级匿名汇总，不承诺数据库管理员无法关联身份的密码学匿名。
- 31 ACTIVE指当前主协调查询结果，新增/合并后以实际目录为准；本矩阵不要求把85个操作全部堆成85张首页卡。
- 待开发增强功能见REQUIREMENTS.md，不混入上表计数；计划项不能仅改状态为ACTIVE。


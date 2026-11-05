# v3数据字典与迁移合同

## 当前物理实现与剩余迁移

server/repositories-v3.mjs 把apps/categories/announcements/banners/favorites/recentUses/organizations/users/sessions/roles/books/copies/reservations/loans/files/points/prices/printOrders/halls/stalls/products/inventory/diningOrders/notifications/jobs/audit/idempotency/payments路由到独立v3_*表，含FK/索引/业务唯一及关联表。db.mjs事务采用BEGIN IMMEDIATE和嵌套SAVEPOINT；typed_core_v3_2一次性迁移旧核心，旧JSON保存在v3_legacy_migration_archive作恢复证据，不作为业务读写真相。已经有真实旧库迁移/FK/回滚测试，更多失败场景仍待测。

独立新增：v3_print_quotes、v3_pickup_credentials、v3_dining_feedback及replies、service_guides/guide_versions、rule_definitions/rule_versions/rule_bindings、v3_outbox_events/v3_job_attempts，以及连接/功能开关等治理表。PrintQuote10分钟；凭证hash+AES-256-GCM密文，演示密钥在DB目录.demo-credential-key，生产必须CREDENTIAL_ENCRYPTION_KEY。备份/恢复必须包含密钥。

明确限制：legacy records仍承载campus/extension/utility B域，尚未完成v3全域关系模型；v3_product_variants的productId UNIQUE，每商品仅默认规格，不是任意多规格。ServiceDefinition、完整IdentityMapping、表单/节点/候补/场次等下文目标模型不能据同名旧模块视为已建成。JSON字段允许用于参数/历史快照和固定白名单配置，B域万能records仍是待消除偏差。

测试使用DB_PATH隔离且NODE_TEST_CONTEXT缺DB_PATH在开库前拒绝；测试物理PDF存储尚未全部隔离，历史误连和精准清理记录见TEST_REPORT。

规范源：docs/v3/SPEC_V3.txt第06章，以下完整保留其数据/状态合同。当前核心已有typed迁移；B域仍有records(kind,id,data)，故全量关系模型尚未满足v3。不允许用万能orders/applications或JSON payload替代核心可索引关系；JSON仅规则、表单版本、历史快照及明确允许数组。

## 迁移门槛

1. 独立领域表，真实FK/唯一/索引；id不可预测、createdAt/updatedAt、并发状态version。
2. 关键唯一：User.campusId；IdentityMapping(provider,subject)；Role.code；各关联联合键；Session.tokenHash；BookCopy.barcode；BookLoan.reservationId；InventorySlot(variantId,date,slot)；PickupCredential(domain,orderId)/tokenHash；IdempotencyRecord(userId,operation,key)；OutboxEvent.eventKey；ServiceCase(sourceDomain,sourceId)；ActivityRegistration(userId,activityId)；ActivityCheckIn.registrationId等。
3. 校验用事务/条件更新：占册、借阅、库存、资源hold、释放、核销、幂等及通知。来源实体为真相；Task/Calendar/Analytics仅可重建只读投影。
4. 主协调指定单一迁移负责人；迁移与seed可重复，不改已操作业务，不启动时清空。演示reset精确确认，production拒绝。
5. 新库干净启动、旧库迁移/备份恢复、FK/唯一负例、并发与回滚均需实际测试；现文件不宣称迁移已完成。

## 原规格第06章完整字段和状态

06 数据字典、字段合同与状态机
06.1 字段规范
所有业务主表有id、createdAt、updatedAt，需要状态并发更新的有version。ID不可预测；金额amountCents为整数；所有外部标识provider+externalId联合唯一；可见身份用campusId但不作外部猜测授权。状态枚举以本章为准。下列除明确可空字段外为必填；关联ID外键存在；文本最大长度服务端校验。json只用于快照/白名单配置，不能代替核心可索引关系。通用长度：名称1100，说明12000，原因1500，标题1100，代码3~64且[a-zA-Z0-9_-]，Markdown正文≤30000字符；q≤100；用户上传附件除PDF打印外只允许png/jpg/pdf，≤10MB、每申请≤5个，无脚本/HTML/可执行文件。mime与内容签名双查。
06.2 平台与认证实体
User：campusId唯一、displayName、organizationId、status ACTIVE/DISABLED。
Organization：name、type CAMPUS/COLLEGE/DEPARTMENT/CLASS、parentId可空。
IdentityMapping：provider、subject、userId，前两联合唯一。
Role：code唯一、name、isSystem；Permission：code唯一、description；UserRole、RolePermission联合唯一。
OperatorScope：userId、roleId、resourceType、resourceId，组合唯一。
Session：tokenHash唯一、userId、activeRoleId可空、expiresAt；禁止存明文token。
CampusApp：code唯一、name、icon、description、categoryId、status、internalPath或externalUrl、sortOrder、recommended；AppCategory、AppVisibility；Favorite(userId,appId唯一)、RecentUse(lastUsedAt)。
ServiceDefinition：code、name、categoryId、ownerDepartmentId、ownerUserId、appId、integrationMode、ruleVersionId、active；与应用分离。
Announcement/Version：title、summary、body、status、publishAt、expiresAt可空、targetRoles、version；Banner：imageKey、targetPath、enabled、sortOrder。
Notification：userId、type、title、body、targetPath、readAt可空、eventKey唯一；MessageDelivery：eventId、channel、status、externalReceipt可空、error可空。
StoredFile：ownerId、storageKey唯一、originalName、size、mime、pageCount可空、domain、expiresAt可空、deletedAt可空；附件关联另表，不能仅凭fileId随便关联他人文件。
ServiceLocation：campusId、name、type、relativeX/relativeY 0~1、serviceId、hours、contactText。
Feedback：userId、domain、sourceId可空、body、status OPEN/ASSIGNED/PROCESSING/RESOLVED、assignedDepartmentId可空、reply可空；Assignment/Reply子表保留历史。
06.3 图书与空间实体
Book(isbn可空,title,author,publisher,category,coverKey可空,visible)；BookCopy(bookId,barcode唯一,location,status)；BookReservation(userId,bookId,copyId,status,readyAt可空,expiresAt可空,reason可空)；BookLoan(userId,copyId,reservationId唯一,dueAt,returnedAt可空,renewalCount默认0)。BookSuggestion(userId,title,author,isbn可空,reason,status,reviewReply可空)；DigitalResource(name,url,accessPolicy,guide,visibleRoles)。Resource(id,type SEAT/ROOM/VENUE/MEETING_ROOM/LAB/EQUIPMENT,name,campusId,capacity,active,ruleVersionId,ownerDepartmentId)；Space/Seat为Resource扩展数据；Equipment(barcode唯一,resourceId,status)。
ResourceBooking(userId,resourceId,startAt,endAt,quantity默认1,status,reviewerId可空,holdExpiresAt可空,ruleSnapshot,checkInAt可空)；时间区间统一[start,end)，相邻允许，重叠不允许。WaitlistEntry(userId,domain,resourceId,startAt,endAt,status,offeredAt可空,expiresAt可空,confirmedBookingId可空)；CapacityHold(resourceId,slotKey,sourceId,expiresAt,quantity)。NoShowRecord(userId,serviceId,bookingId,occurredAt,ruleVersionId,revokedAt可空)；Appeal(noShowId,userId,reason,evidenceFileIds,status,decisionReason可空)。
06.4 打印实体
PrintPoint(campusId,name,hours,acceptingOrders,manualMode)；PrintPriceRule(pointId,version,bwPerSide,colorPerSide,staplePerCopy,validFrom,active)。PrintQuote(userId,fileId,pointId,paramsHash,paramsSnapshot,ruleVersion,amountCents,expiresAt)；PrintOrder(userId,pointId,fileId,quoteId,status,previousStatus可空,paramsSnapshot,priceSnapshot,amountCents,paymentMode,paymentStatus,reason可空)。PrintServiceAppointment(userId,pointId,type,requirements,requestedAt,status,quoteVersion可空,amountCents可空,confirmedAt可空)。Device(provider,externalId,pointId,status)；DeviceTask(orderId,deviceId,externalTaskId可空,status,lastReceipt可空)；AfterSaleCase(userId,orderId,reason,status,solution可空,reprintTaskId可空)。
06.5 餐饮实体
DiningHall(campusId,name)；Stall(hallId,name,hours,acceptingOrders)；Product(stallId,name,description,imageKey可空,active)；ProductVariant(productId,name,priceCents,active)。InventorySlot(variantId,date,slot,remaining,version)，前3联合唯一；SlotCapacity(stallId,date,startAt,endAt,maxOrders,occupied,version)。DiningOrder(userId,stallId,status,pickupDate,pickupSlot,capacitySlotId可空,amountCents,paymentMode,paymentStatus,stockReleasedAt可空,reason可空)；DiningOrderItem(orderId,variantId,nameSnapshot,specSnapshot,unitPriceCents,quantity,ingredientSnapshot)。IngredientNotice(productId,ingredients,allergenTags,unknownFlag,updatedBy)；GroupMealRequest(userId,stallId,peopleCount,requestedAt,budgetCents可空,requirements,status,quoteVersion可空)；ManualQuote(sourceType,sourceId,version,amountCents,description,expiresAt,acceptedAt可空)。PickupCredential(domain,orderId,tokenHash唯一,encryptedToken,usedAt可空)，domain+orderId唯一；PaymentRecord(domain,orderId,mode,status,amountCents,confirmedBy可空,confirmedAt可空)，禁止虚构真实渠道流水。凭证随机token加密存储供本人重显、hash核验；服务器密钥只在环境；订单完成废止有效凭证。不采用固定六位测试码作为生产设计。
06.6 后勤活动与设备
RepairTicket(userId,location,category,description,status,assignedAgentId可空,finishedAt可空,confirmedAt可空)；WorkOrderAction记录动作及旧新状态。LogisticsAppointment(userId,serviceId,location,slotId,status,quoteSnapshot可空)；ServiceSlot(serviceId,startAt,endAt,capacity,occupied)。DormIssue(userId,buildingId,category,description,status,assignedAgentId可空)；FacilityPoint(locationId,type,state,stateSource,updatedAt)；FaultReport(pointId,userId,description,status)。ShuttleRoute(name,stopsJson)；Trip(routeId,departAt,capacity,occupied,status)；TripBooking(userId,tripId,status,checkInAt可空)。ExpressServicePoint(locationId,providersJson,hours,guide)；LostFoundPost(userId,type,category,publicDescription,privateFeatures,status,reviewReason可空)；ClaimRequest(postId,userId,privateEvidence,status,handedOverAt可空)。TrainingRoom(resourceId,safetyRequirements)；LabApplication(userId,resourceId,startAt,endAt,participants,safetyChecklist,status,reviewerId可空)；EquipmentLoan(userId,equipmentId,startAt,endAt,status,checkedOutAt可空,returnedAt可空,damageNote可空)。Activity(type ACTIVITY/LECTURE,title,description,startAt,endAt,location,capacity,deadline,allowedRoles,status,ownerId)；ActivityRegistration(userId,activityId,status)联合唯一；ActivityCheckIn(registrationId唯一,checkedAt,operatorId可空)。讲座不另建重复报名内核。
06.7 办事与教学
ServiceGuide(serviceId,title,ownerDepartmentId,currentVersionId,status)；GuideVersion(guideId,version,conditions,materials,steps,contact,validFrom,validTo可空)。FormDefinition(serviceId,name)；FormVersion(formId,version,fieldsJson,status)；ApplicationDraft(userId,serviceId,formVersionId,valuesJson)；ServiceApplication(userId,serviceId,formVersionId,workflowVersionId,valuesSnapshot,status,currentNode,submittedAt)。WorkflowDefinition(serviceId,version,nodesJson,status)；ReviewAction(applicationId,nodeIndex,actorId,action,reason)；MaterialRequirement(formVersionId,key,required)；MaterialVersion(applicationId,key,fileId,version)；SupplementRequest(applicationId,missingKeys,reason,dueAt,resubmittedAt可空)。ServiceWindow(departmentId,name,serviceIds)；WindowSlot(windowId,startAt,endAt,capacity,occupied)；WindowAppointment(userId,slotId,serviceId,status)。CertificateRequest(applicationId,type,status,issueMode)；DocumentIssueRecord(requestId,fileId,mode,issuerId,issuedAt)。JourneyDefinition(code,name,version,tasksJson,status)；JourneyInstance(userId,definitionId,versionSnapshot,status)；JourneyTask(instanceId,stepCode,sourceDomain,sourceId可空,status,skippedReason可空)。Term(name,startDate,endDate)；Course(code,name)；TeachingClass(courseId,termId,externalId可空,teacherId)；Enrollment(userId,teachingClassId)；CourseSession(teachingClassId,startAt,endAt,location,status,sourceVersion)。CourseMaterial(teachingClassId,fileId,uploadedBy)；GroupBinding(teachingClassId,provider,externalGroupId,groupType,mode,status)；LiveBinding(sessionId唯一,provider,externalId可空,mode,status,entryUrl可空)。AttendanceTask(sessionId,opensAt,closesAt,status)；AttendanceRecord(taskId,userId联合唯一,checkedAt,status,correctedBy可空)；CorrectionRequest(recordId,userId,reason,status)。ConsultationSlot(teacherId,startAt,endAt,capacity,occupied,location)；ConsultationBooking(userId,slotId,topic,status)。InternshipApplication(userId,guideVersionId,organizationName,plan,materials,status,assignedTeacherId,departmentId)。
06.8 平台治理及智能实体
RuleDefinition(code,serviceId,type)；RuleVersion(ruleId,version,configJson,status,effectiveAt)；RuleBinding(sourceType,sourceId,ruleVersionId)。ServiceCase(sourceDomain,sourceId联合唯一,departmentId,agentId可空,status,priority)；SlaPolicy(serviceId,acceptHours,completeHours,version)；SlaClock(caseId,startedAt,pausedSegmentsJson,completedAt可空)；CaseEscalation(caseId,eventKey唯一,reason)。IntegrationConnection(provider,mode,enabled,configStatus,lastTestAt可空,lastError可空,ownerId)；ExternalIdMapping(provider,domain,externalId,internalId)；IntegrationTest(connectionId,mode,outcome,summary)。OutboxEvent(type,sourceId,eventKey唯一,payload,status)；Job(type,eventId可空,payload,status,attempts,nextRunAt,lockedAt可空,lastError可空,dedupeKey唯一)；JobAttempt(jobId,startAt,endAt,outcome,error可空)。AuditLog(actorId,activeRoleId,action,resourceType,resourceId,outcome,requestId,metadata)；IdempotencyRecord(userId,operation,key联合唯一,requestHash,responseSnapshot,expiresAt)。AssistantQueryLog(userId,redactedQuestion,sourceVersionIds,mode,outcome)；ServiceIntent(serviceId,aliases,keywords,priority)；IntentMatch仅运行结果可不持久化。Setting(key唯一,valueJson)；SystemRelease(version,environment,releasedAt,notes)；FeatureFlag(code,enabled,scopeJson)；HealthCheck(component,status,checkedAt,summary)。统计投影和CalendarProjection、TaskProjection可由查询实时计算；若持久化必须可从源重建，不能成为第二个业务真相。
06.9 状态及动作白名单
实体
状态
允许动作概要
应用
DRAFT/ACTIVE/MAINTENANCE/PLANNED/DISABLED
运营发布/维护/停用，校验路由
图书册
AVAILABLE/RESERVED/ON_LOAN/UNAVAILABLE
由预约、领取、归还事务驱动
图书预约
PENDING/READY/FULFILLED/CANCELLED/EXPIRED/REJECTED
ready/reject/fulfill/cancel/expire
借阅
ACTIVE/RETURNED
renew/return
打印
SUBMITTED/ACCEPTED/PROCESSING/READY/COMPLETED/CANCELLED/REJECTED/EXCEPTION
accept/start/ready/cancel/reject/exception/resolve/redeem
餐单
SUBMITTED/ACCEPTED/PREPARING/READY/COMPLETED/CANCELLED/REJECTED
accept/prepare/ready/cancel/reject/redeem
付款P0
UNPAID/PAID_OFFLINE/SIMULATED_PAID
确认对应模式；退款P1单独扩展
资源预约
PENDING_REVIEW/CONFIRMED/CHECKED_IN/COMPLETED/CANCELLED/REJECTED/EXPIRED/NO_SHOW
审批、取消、签到、到期任务；具体章节规则优先
候补
WAITING/OFFERED/CONFIRMED/CANCELLED/EXPIRED
offer/confirm/cancel/expire
设备借用
SUBMITTED/APPROVED/ON_LOAN/RETURNED/REJECTED/CANCELLED
批准、领取、归还
申请
DRAFT/SUBMITTED/ACCEPTED/REVIEWING/RETURNED/RESUBMITTED/COMPLETED/REJECTED/CANCELLED
白名单审核；本人仅受理前取消
活动
DRAFT/PUBLISHED/CANCELLED/COMPLETED
发布、取消、结束
报名
CONFIRMED/CANCELLED/ATTENDED/NO_SHOW
报名、取消、签到、结束核对
反馈
OPEN/ASSIGNED/PROCESSING/RESOLVED
转派、处理、回复、解决
任务
PENDING/RUNNING/SUCCEEDED/FAILED
领取、完成、有限重试

终态禁止重复副作用；拒绝需原因。订单状态不能由任意PATCH直接设置。通用动作必须有源状态、目标状态、活动角色、范围、条件、副作用、审计和通知。

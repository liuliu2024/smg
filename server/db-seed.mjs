if(process.env.APP_MODE==='production'){console.error('production禁止写入演示数据');process.exit(1)}
await import('./main.mjs');
const {db,all}=await import('./db.mjs');
if(!db.prepare("SELECT id FROM v3_service_guides WHERE serviceId='library'").get()){
 const {catalogV3}=await import('./catalog-v3.mjs'),u={id:'operator',activeRole:'CAMPUS_OPERATOR'};
 const g=catalogV3(u,['admin','guides'],'POST',{title:'图书预约与借阅指南（演示）',serviceId:'library',ownerDepartmentId:'org1',ownerId:'operator',conditions:'使用平台虚构学生或教师身份登录。',materials:'无需真实证件或个人资料。',steps:'检索图书并预约；馆员确认待取；本人到馆领取；在我的服务查看借阅记录。所有记录仅为本地演示。',contact:'演示图书服务窗口，正式联系方式待学校确认。',location:'演示校区图书馆',processingTime:'以工作人员实际受理为准，非正式办理承诺。',fees:'待确认',entryPath:'/library'},new URL('http://localhost')).data;
 catalogV3(u,['admin','guides',g.id,'publish'],'POST',{versionId:g.draftVersionId},new URL('http://localhost'));
}
console.log('幂等演示初始化完成：',all('users').length,'个虚构用户，',all('books').length,'条书目');
db.close();

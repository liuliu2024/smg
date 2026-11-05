import {test,expect} from '@playwright/test';
test('T-F27/F29 mobile student and merchant complete feedback using visible controls',async({browser})=>{
 const student=await browser.newContext({baseURL:'http://localhost:3999',viewport:{width:390,height:844}}),merchant=await browser.newContext({baseURL:'http://localhost:3999',viewport:{width:390,height:844}});
 try{
  const page=await student.newPage();await page.goto('/');await page.getByRole('button',{name:'知夏 林知夏 学生'}).click();await expect(page.getByRole('heading',{name:'你好，林知夏'})).toBeVisible();
  await page.getByRole('link',{name:/智慧食堂 选择档口/}).click();await page.getByRole('spinbutton',{name:'香菇鸡肉饭份数'}).first().fill('1');
  await page.locator('#diningForm input[name=pickupDate]').fill(new Date(Date.now()+32*3600000).toISOString().slice(0,10));await page.locator('#diningForm select[name=pickupSlot]').selectOption('LUNCH');await page.locator('#diningForm select[name=paymentMode]').selectOption('SIMULATED');await page.getByRole('button',{name:'提交餐单',exact:true}).click();
  await expect(page.getByRole('heading',{name:'我的餐单',exact:true})).toBeVisible();await page.getByRole('link',{name:'查看详情',exact:true}).first().click();await expect(page.getByRole('heading',{name:'投诉与反馈'})).toBeVisible();
  const orderURL=page.url(),message='移动端自动验收 '+Date.now();await page.locator('#diningFeedbackForm select').selectOption('SERVICE');await page.locator('#diningFeedbackForm textarea').fill(message);await page.getByRole('button',{name:'提交反馈',exact:true}).click();await expect(page.getByText(message,{exact:true})).toBeVisible();await expect(page.getByText('待处理',{exact:true})).toBeVisible();
  const staff=await merchant.newPage();await staff.goto('/');await staff.getByRole('button',{name:'商户 一号档口商户 食堂商户'}).click();await staff.getByRole('link',{name:'餐饮反馈',exact:true}).click();const card=staff.locator('.feedback-admin-record').filter({hasText:message});await expect(card).toBeVisible();await card.locator('textarea').fill('移动端演示处理完成');await card.getByRole('button',{name:'回复并标为解决'}).click();await staff.getByRole('button',{name:'确认',exact:true}).click();await expect(card.getByText('已解决',{exact:true})).toBeVisible();
  await page.goto(orderURL);await expect(page.getByText('移动端演示处理完成',{exact:true})).toBeVisible();await expect(page.getByText('已解决',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/screenshots/v3-mobile-feedback.png',fullPage:true});
 }finally{await student.close();await merchant.close()}
});

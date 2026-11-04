import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const out=process.env.SCREENSHOT_DIR||'artifacts/screenshots'; await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:3000');
await page.locator('[data-login="student"]').click();
await page.waitForSelector('.desk-grid');
const base=out+'/';
for(const [name,path] of [['home','/'],['apps','/apps'],['printing','/printing/new'],['dining','/dining']]){
 await page.goto('http://localhost:3000'+path);await page.waitForSelector('#content');await page.waitForTimeout(400);await page.screenshot({path:base+name+'.png',fullPage:true});
}
await page.setViewportSize({width:390,height:844});await page.goto('http://localhost:3000/');await page.waitForSelector('.desk-grid');
const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
await page.screenshot({path:base+'mobile.png',fullPage:true});
await page.request.post('http://localhost:3000/api/v1/auth/logout',{headers:{Origin:'http://localhost:3000'},data:{}});
await page.goto('http://localhost:3000/login');await page.locator('[data-login="admin"]').click();await page.goto('http://localhost:3000/admin');await page.setViewportSize({width:1440,height:1000});await page.waitForSelector('#adminContent');await page.waitForTimeout(300);await page.screenshot({path:base+'admin.png',fullPage:true});
console.log(JSON.stringify({overflow,errors}));await browser.close();if(overflow.scroll>overflow.width||errors.length)process.exitCode=1;



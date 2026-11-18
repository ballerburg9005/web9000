import puppeteer from 'puppeteer-core';
const b=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,
 args:['--no-sandbox','--disable-dev-shm-usage']});
const errors=[],p=await b.newPage();
p.on('pageerror',error=>errors.push(error.message));
async function until(fn,label,timeout=35000){
 const end=Date.now()+timeout;
 while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,140));}
 throw Error('Live test timeout: '+label+' '+JSON.stringify(errors));
}
try{
 await p.setViewport({width:1440,height:830});
 await p.goto(process.env.WEB9000_LIVE_URL||'https://syburg.my.to/web9000/v2/',{waitUntil:'domcontentloaded'});
 await p.waitForSelector('html[data-web9000-classic-ready="1"]');
 await until(()=>p.evaluate(()=>document.querySelectorAll('.post').length>=26&&
   document.querySelector('#peerStatus').textContent.includes('1 peer(s)')),
   '26 real signed demo posts and live peer');
 await until(()=>p.evaluate(()=>document.querySelectorAll('.group-entry').length>=3), 
   'signed sample groups including recommendations');
 const status=await p.evaluate(()=>({
   posts:document.querySelectorAll('.post').length,
   mediaAudio:document.querySelectorAll('.post .mini-audio').length,
   mediaVideo:document.querySelectorAll('.post .hover-video').length,
   peer:document.getElementById('peerStatus').textContent,
   example:document.querySelector('.post-headline')?.textContent
 }));
 console.log('LIVE_BOARD',JSON.stringify(status));
 if(status.mediaAudio<1||status.mediaVideo<2)throw Error('Live seeded audio/video not rendered');
 await p.evaluate(()=>document.getElementById('clansButton').click());
 await until(()=>p.evaluate(()=>document.getElementById('groupList').textContent.includes('Open Media Circle')),
   'signed demo group recommendation');
 await p.evaluate(()=>{
   const group=[...document.querySelectorAll('.group-entry')].find(x=>
     x.textContent.includes('Open Media Circle'));
   group.querySelector('.group-actions button').click();
 });
 await until(()=>p.evaluate(()=>document.getElementById('recommendedSpaceLinks').textContent.includes('/music')),
   'followed signed group recommended namespace');
 await p.evaluate(()=>document.getElementById('closeClans').click());
 const first=await p.evaluate(()=>document.querySelector('.post[data-index="2"]')?.dataset.id);
 await p.evaluate(id=>document.querySelector('.post[data-id="'+id+'"]').click(),first);
 await until(()=>p.evaluate(()=>document.querySelector('.expanded-body .author-profile-link')!==null),'author link');
 await p.evaluate(()=>document.querySelector('.author-profile-link').click());
 await until(()=>p.evaluate(()=>document.querySelector('.profile-title')?.textContent.includes('WEB9000 Demo Publisher')),
   'signed real demo public profile');
 console.log('LIVE_PROFILE',JSON.stringify(await p.evaluate(()=>({
   name:document.querySelector('.profile-title').textContent,
   stats:[...document.querySelectorAll('.profile-stat')].map(x=>x.textContent),
   desc:document.querySelector('.profile-description').textContent.slice(0,100),
   posts:document.querySelectorAll('.post').length
 }))));
 await p.setViewport({width:390,height:844});
 console.log('MOBILE_OVERFLOW',await p.evaluate(()=>
   document.documentElement.scrollWidth-document.documentElement.clientWidth));
 if(errors.length)throw Error('Browser page errors: '+JSON.stringify(errors));
 console.log('PASS live signed demo data, IPFS imageboard, sample media, group-recommended spaces and signed profile');
}finally{await b.close();}
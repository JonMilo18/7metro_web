const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {stripTypeScriptTypes}=require('node:module');
function load(file,extra={}){
 const context={URL,Request,Response,Headers,TextEncoder,Uint8Array,crypto:crypto.webcrypto,atob,btoa,AbortSignal,fetch,...extra};vm.createContext(context);
 let source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../'+file),'utf8')).replace(/^import .*?;\r?\n/gm,'').replace(/export /g,'');
 source+='\nthis.api={'+(file==='push-actions.ts'?'allowedPushEndpoint,handlePushAction':'handlePushWorker,pushPayload')+'};';
 vm.runInContext(source,context);return context.api;
}
const actions=load('push-actions.ts'),worker=load('push-worker.ts',{allowedPushEndpoint:actions.allowedPushEndpoint});
test('subscription registration validates provider URLs, encryption keys and authenticated account ownership',async()=>{
 for(const url of ['https://localhost/x','https://127.0.0.1/x','http://fcm.googleapis.com/x','https://fcm.googleapis.com.evil.test/x','https://user:pass@fcm.googleapis.com/x','https://fcm.googleapis.com:8443/x'])assert.equal(actions.allowedPushEndpoint(url),false,url);
 for(const url of ['https://fcm.googleapis.com/fcm/send/x','https://web.push.apple.com/x','https://updates.push.services.mozilla.com/wpush/v2/x'])assert(actions.allowedPushEndpoint(url));
 const receiver=crypto.createECDH('prime256v1');receiver.generateKeys();
 const prefs={callups:true,schedule:true,notices:true,responses:true,friends:true};
 const payload={action:'push_save',device_secret:'d'.repeat(64),user_id:99,language:'es',preferences:prefs,subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:receiver.getPublicKey().toString('base64url'),auth:crypto.randomBytes(16).toString('base64url')}}};
 let parameters;const database={rpc:async(name,args)=>{parameters=args;return {data:{ok:true,binding:'11111111-1111-4111-8111-111111111111'}}}};
 const response=(status,body)=>({status,body});
 const result=await actions.handlePushAction(payload,database,2,'session-token','PUBLIC_KEY',true,response);
 assert.equal(result.status,200);assert.equal(parameters.p_user,2);assert.equal(parameters.p_session,crypto.createHash('sha256').update('session-token').digest('hex'));
 assert.equal(parameters.p_device,crypto.createHash('sha256').update(payload.device_secret).digest('hex'));assert.equal(parameters.p_data.language,'es');
 for(const changes of [{subscription:{...payload.subscription,endpoint:'https://localhost/admin'}},{subscription:{...payload.subscription,keys:{p256dh:'bad',auth:'bad'}}},{preferences:{friends:true}},{device_secret:'x'}]){
  assert.equal((await actions.handlePushAction({...payload,...changes},database,2,'token','key',true,response)).status,400);
 }
 assert.equal((await actions.handlePushAction(payload,database,2,'token','',false,response)).status,503);
});
test('worker encrypts real Web Push messages, protects its endpoint and never includes private notes',async()=>{
 const {generateRequestDetails,generateVAPIDKeys}=await import('web-push');
 const keys=generateVAPIDKeys(),vapid={...keys,subject:'https://jonmilo18.github.io/7metro_web/'};
 const receiver=crypto.createECDH('prime256v1');receiver.generateKeys();const auth=crypto.randomBytes(16);
 const job={id:1,lease:'11111111-1111-4111-8111-111111111111',notification_id:7,kind:'friends',target:{id:9,note:'PRIVATE NOTE'},endpoint:'https://fcm.googleapis.com/fcm/send/test',p256dh:receiver.getPublicKey().toString('base64url'),auth:auth.toString('base64url'),binding:'22222222-2222-4222-8222-222222222222',language:'es'};
 const finished=[];let fetchCalls=0;
 const db={rpc:async(name,args)=>name==='push_claim'?{data:[job]}:(finished.push(args),{data:null})};
 const request=new Request('https://example.test/worker',{method:'POST',headers:{'x-7metro-push-worker':'SECRET'}});
 const fakeFetch=async(url,options)=>{
  fetchCalls++;assert.equal(url,job.endpoint);assert.equal(options.redirect,'error');assert.equal(options.method,'POST');
  assert.equal(new Headers(options.headers).has('Topic'),false,'Single-digit notification IDs must not create invalid Apple push topics');
  const decoded=JSON.parse(require('http_ece').decrypt(Buffer.from(options.body),{version:'aes128gcm',privateKey:receiver,authSecret:auth.toString('base64url')}).toString());
  assert.equal(decoded.title,'Nueva solicitud de amistad');assert.equal(decoded.notification_id,7);assert.equal(decoded.binding,job.binding);assert(!JSON.stringify(decoded).includes('PRIVATE NOTE'));
  return new Response(null,{status:201});
 };
 const unauthorized=await worker.handlePushWorker(new Request('https://example.test'),db,vapid,'SECRET',generateRequestDetails,fakeFetch);assert.equal(unauthorized.status,401);assert.equal(fetchCalls,0);
 const nonce='11111111-1111-4111-8111-111111111111',timestamp=Math.floor(Date.now()/1000);
 const signature=crypto.createHmac('sha256','SECRET').update(timestamp+':'+nonce).digest('hex');let used=false;
 const signedDb={rpc:async name=>name==='push_consume_wake'?{data:!used&&(used=true)}:{data:[]}};
 const signedRequest=()=>new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json','x-7metro-push-signature':signature},body:JSON.stringify({nonce,timestamp})});
 assert.equal((await worker.handlePushWorker(signedRequest(),signedDb,vapid,'SECRET',generateRequestDetails,fakeFetch)).status,200);
 assert.equal((await worker.handlePushWorker(signedRequest(),signedDb,vapid,'SECRET',generateRequestDetails,fakeFetch)).status,401);
 const health=await worker.handlePushWorker(new Request('https://example.test?health=1',{method:'POST',headers:{'x-7metro-push-worker':'SECRET'}}),db,vapid,'SECRET',generateRequestDetails,fakeFetch);
 assert.equal(health.status,200);assert.equal((await health.json()).ready,true);assert.equal(fetchCalls,0,'Health checks do not send notifications');
 const result=await worker.handlePushWorker(request,db,vapid,'SECRET',generateRequestDetails,fakeFetch);
 assert.equal(result.status,200);assert.equal((await result.json()).sent,1);assert.equal(finished[0].p_status,201);assert.equal(finished[0].p_lease,job.lease);
 job.endpoint='https://127.0.0.1/private';await worker.handlePushWorker(request,db,vapid,'SECRET',generateRequestDetails,fakeFetch);assert.equal(fetchCalls,1);assert.equal(finished.at(-1).p_status,400);
 job.endpoint='https://fcm.googleapis.com/fcm/send/test';await worker.handlePushWorker(request,db,vapid,'SECRET',generateRequestDetails,async()=>new Response(null,{status:410}));assert.equal(finished.at(-1).p_status,410);
 job.endpoint='https://web.push.apple.com/test';job.kind='test';
 const apple=await worker.handlePushWorker(request,db,vapid,'SECRET',generateRequestDetails,async(url,options)=>{
  const headers=new Headers(options.headers);assert.equal(headers.has('Topic'),false);assert.equal(headers.get('Urgency'),'high');
  return new Response(JSON.stringify({reason:'BadWebPushTopic'}),{status:400});
 });
 assert.deepEqual(JSON.parse(JSON.stringify((await apple.json()).errors)),[{status:400,reason:'BadWebPushTopic'}]);
 job.kind='callups';job.target={kind:'session',reason:'reminder',note:'PRIVATE NOTE'};job.language='eu';
 const reminder=worker.pushPayload(job);
 assert.equal(reminder.title,'Deialdiaren oroigarria');
 assert.equal(reminder.body,'Ireki aplikazioa deialdiari erantzuteko.');
 assert(!JSON.stringify(reminder).includes('PRIVATE NOTE'));
});

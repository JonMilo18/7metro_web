const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync(require.resolve('../friend-search.ts'),'utf8');
const context={};vm.createContext(context);
vm.runInContext(stripTypeScriptTypes(source).replace('export async function','async function')+'\nthis.search = searchFriendUsers;',context);
const respond=(status,body)=>({status,body});
test('user search bounds results, escapes wildcard input and exposes only usernames',async()=>{
 const calls=[];const query={};
 for(const name of ['select','neq','ilike','order'])query[name]=(...args)=>{calls.push([name,...args]);return query;};
 query.limit=async n=>{calls.push(['limit',n]);return {data:[{id_erabiltzailea:9,izena:'ane_100%',email:'private@example.test'}]};};
 const result=await context.search({query:'  ane_100%  '},{from:()=>query},7,respond);
 assert.equal(result.status,200);
 assert.deepEqual(JSON.parse(JSON.stringify(result.body)),{ok:true,users:[{username:'ane_100%'}]});
 assert(calls.some(c=>c[0]==='neq'&&c[1]==='id_erabiltzailea'&&c[2]===7));
 assert(calls.some(c=>c[0]==='ilike'&&c[2]==='%ane\\_100\\%%'));
 assert(calls.some(c=>c[0]==='limit'&&c[1]===8));
});
test('empty and invalid searches do not query users, and database failures are handled',async()=>{
 const database={from:()=>{throw Error('Unexpected query');}};
 assert.equal((await context.search({query:' '},database,7,respond)).status,200);
 for(const query of [undefined,{},'x'.repeat(201)])assert.equal((await context.search({query},database,7,respond)).status,400);
 const failed={select(){return this},neq(){return this},ilike(){return this},order(){return this},async limit(){return {error:{message:'private database error'}}}};
 const response=await context.search({query:'ane'},{from:()=>failed},7,respond);
 assert.equal(response.status,500);assert(!JSON.stringify(response).includes('private database'));
});

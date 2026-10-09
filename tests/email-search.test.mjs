import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

async function fixture(data = {}) {
 const bundle = await build({
  entryPoints:["tests/fixtures/unread-worker.ts"],bundle:true,write:false,format:"esm",platform:"browser",target:"es2022",external:["cloudflare:*","node:*","path"],
  banner:{js:'import * as nodePath from "node:path"; const require = (name) => { if (name === "path") return nodePath; throw new Error(`Unexpected require: ${name}`); };'},
 });
 const runtime = new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:"2025-11-28",compatibilityFlags:["nodejs_compat"],durableObjects:{MAILBOX:{className:"MailboxDO",useSQLite:true}},r2Buckets:["BUCKET"]});
 const seed = async data => { const r=await runtime.dispatchFetch("https://test/__seed",{method:"POST",body:JSON.stringify(data)});assert.equal(r.status,204); };
 await seed(data);
 const get = async (path, expected=200) => {const r=await runtime.dispatchFetch(`https://test${path}`);assert.equal(r.status,expected);return r.json();};
 const search = (params,box) => get(`${box?`/api/v1/mailboxes/${box}`:'/api/v1'}/search?${new URLSearchParams(params)}`);
 return {runtime,seed,get,search,close:()=>runtime.dispose()};
}
const message=(id,overrides={})=>({id,subject:"Routine update",date:"2026-10-09",body:"Ordinary text",read:true,...overrides});

test("search scans full bodies beyond the preview and respects mailbox scope",async()=>{
 const tail=" x".repeat(6000)+" 正文深处唯一关键词";
 const f=await fixture({"a@example.com":[message("same",{body:tail})],"b@example.com":[message("same",{body:tail})],"empty@example.com":[]});
 try{
  const all=await f.search({query:"正文深处唯一关键词",limit:"1"});assert.equal(all.totalCount,2);assert.equal(all.emails[0].mailbox_id,"a@example.com");assert(!all.emails[0].snippet.includes("正文深处唯一关键词"));
  const next=await f.search({query:"正文深处唯一关键词",limit:"1",cursor:all.nextCursor});assert.equal(next.emails[0].mailbox_id,"b@example.com");assert.equal(next.nextCursor,null);
  const scoped=await f.search({query:"正文深处唯一关键词"},"a@example.com");assert.equal(scoped.totalCount,1);assert.deepEqual(scoped.emails.map(e=>e.id),["same"]);
  assert.equal((await f.search({query:"正文深处唯一关键词"},"empty@example.com")).totalCount,0);
 }finally{await f.close();}
});

test("original subjects, AI titles, body words and phrases remain searchable",async()=>{
 const f=await fixture({"a@example.com":[message("subject",{subject:"Project launch"}),message("ai",{ai_title:"审核设计方案"}),message("body",{subject:"Friday meeting",body:"<p>Prepare the project launch.</p>"}),message("split",{subject:"Friday",body:"<p>Schedule the launch</p>"})]});
 try{
  assert.deepEqual((await f.search({query:"审核设计"})).emails.map(e=>e.id),["ai"]);
  assert.deepEqual((await f.search({query:'"project launch"'})).emails.map(e=>e.id),["body","subject"]);
  assert.deepEqual((await f.search({query:"launch Friday"})).emails.map(e=>e.id),["body","split"]);
  assert.deepEqual((await f.search({query:"launch Friday"},"a@example.com")).emails.map(e=>e.id),["body","split"]);
 }finally{await f.close();}
});

test("search treats SQL wildcards and injection-like text literally",async()=>{
 const f=await fixture({"a@example.com":[message("literal",{body:"100% complete; file_name; C:\\tmp"}),message("similar",{body:"1000 complete; fileXname; C:xtmp"})]});
 try{
  for(const query of ["100%","file_name","C:\\tmp"]){assert.deepEqual((await f.search({query})).emails.map(e=>e.id),["literal"]);}
  assert.equal((await f.search({query:"%' OR 1=1 --"})).totalCount,0);
  assert.equal((await f.search({query:"Routine"})).totalCount,2);
 }finally{await f.close();}
});

test("unified search traverses tied dates and overlapping IDs without omissions, even after a new arrival",async()=>{
 const data=Object.fromEntries(["a","b","z"].map(box=>[`${box}@example.com`,Array.from({length:27},(_,i)=>message(String(i).padStart(2,"0"),{body:"中文游标全文命中",date:i<24?"2026-10-09":"2026-10-08"}))]));
 const f=await fixture(data);
 try{
  const seen=[];let cursor;let first=true;
  do{
   const page=await f.search({query:"中文游标",limit:"7",...(cursor?{cursor}:{})});assert.equal(page.totalCount,first?81:82);seen.push(...page.emails.map(e=>`${e.mailbox_id}/${e.id}`));cursor=page.nextCursor;
   if(first){await f.seed({"b@example.com":[message("new",{body:"中文游标全文命中",date:"2030-01-01"})]});first=false;}
  }while(cursor);
  assert.equal(seen.length,81);assert.equal(new Set(seen).size,81);assert(!seen.includes("b@example.com/new"));
  assert.deepEqual(new Set(seen),new Set(Object.entries(data).flatMap(([box,messages])=>messages.map(m=>`${box}/${m.id}`))));
 }finally{await f.close();}
});

test("advanced filters apply before limiting and share the same counts in both scopes",async()=>{
 const attachment={id:"attachment",email_id:"match",filename:"plan.pdf",mimetype:"application/pdf",size:1};
 const f=await fixture({"a@example.com":[message("match",{body:"deadline",sender:"Alex <alex@example.org>",recipient:"team@example.com",folder:"archive",read:false,starred:true,attachments:[attachment]}),message("wrong-folder",{body:"deadline",read:false,starred:true}),message("read",{body:"deadline",folder:"archive",read:true,starred:true})],"b@example.com":[message("other",{body:"deadline",folder:"archive",read:false,starred:false})]});
 try{
  const filters={query:"deadline",folder:"archive",from:"alex",to:"team@example.com",date_start:"2026-10-01",date_end:"2026-11-01",is_read:"false",is_starred:"true",has_attachment:"true",limit:"1"};
  for(const box of [undefined,"a@example.com"]){const page=await f.search(filters,box);assert.equal(page.totalCount,1);assert.deepEqual(page.emails.map(e=>e.id),["match"]);}
 }finally{await f.close();}
});

test("search cursors cannot be reused with another query or filters, and invalid limits are rejected",async()=>{
 const f=await fixture({"a@example.com":[message("1",{body:"alpha beta"}),message("2",{body:"alpha beta"})]});
 try{
  const page=await f.search({query:"alpha",limit:"1"});assert(page.nextCursor);
  for(const params of [{query:"beta",cursor:page.nextCursor},{query:"alpha",is_read:"true",cursor:page.nextCursor},{query:"alpha",folder:"inbox",cursor:page.nextCursor},{query:"alpha",cursor:"!bad"},{query:"alpha",limit:"51"},{query:"alpha",limit:"-1"}])await f.get(`/api/v1/search?${new URLSearchParams(params)}`,400);
 }finally{await f.close();}
});

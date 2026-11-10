/* Benevolent House portal: sign-in and saved records (Supabase). Loaded by the portal home and every course. */
window.BHC=(function(){
 const URL="https://vlnkonohruekslfoazzx.supabase.co";
 const KEY="sb_publishable_Q2sWd7f1pxDzDhpjPBgrZQ_MJolelnk";
 let sb=null,me=null,meLoaded=false,uid=null,tok=null;
 function client(){
  if(sb)return sb;
  if(!window.supabase||!window.supabase.createClient)return null;
  try{sb=window.supabase.createClient(URL,KEY,{auth:{flowType:"implicit",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:"bh-portal-auth"}})}catch(e){sb=null}
  return sb}
 function available(){return !!client()}
 async function session(){const c=client();if(!c)return null;try{const{data}=await c.auth.getSession();const s=data.session||null;if(s){uid=s.user.id;tok=s.access_token}else{tok=null}return s}catch(e){return null}}
 async function profile(force){
  if(meLoaded&&!force)return me;
  const s=await session();if(!s){me=null;uid=null;meLoaded=true;return null}uid=s.user.id;
  const{data,error}=await client().from("profiles").select("id,email,full_name,role,caregiver_type,home_label,home_id").eq("id",s.user.id).maybeSingle();
  if(error){const x=new Error("profile_unavailable");x.unavailable=true;throw x}
  if(data){const r=await client().rpc("my_role");if(r.error){const x=new Error("profile_unavailable");x.unavailable=true;throw x}if(r.data==="none"){me=null;meLoaded=true;return null}}
  me=data?Object.assign(data,{_email:s.user.email}):null;meLoaded=!!data;return me}
 function asUser(p){return p?{name:p.full_name||"",email:p._email||p.email||"",home:p.home_label||"",role:p.caregiver_type||"",cloud:true,id:p.id,access:p.role}:null}
 async function sendCode(email,meta){const c=client();if(!c)throw new Error("offline");
  const{error}=await c.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:location.origin+location.pathname,data:meta||{}}});
  if(error)throw error;return true}
 async function verify(email,token){const c=client();const{data,error}=await c.auth.verifyOtp({email,token:String(token).replace(/\D/g,""),type:"email"});if(error)throw error;meLoaded=false;return data}
 async function saveProfile(f){const s=await session();if(!s)return null;const row={};
  if(f.name!=null)row.full_name=f.name;if(f.home!=null)row.home_label=f.home;if(f.role!=null)row.caregiver_type=f.role;
  const{data,error}=await client().from("profiles").update(row).eq("id",s.user.id).select().maybeSingle();if(!error&&data){me=Object.assign(data,{_email:s.user.email});meLoaded=true}return me}
 async function signOut(){await flushAll();await retryCompletions();const c=client();me=null;uid=null;meLoaded=true;if(c){try{await c.auth.signOut({scope:"local"})}catch(e){}}clearLocal()}
 function clearLocal(){try{Object.keys(localStorage).forEach(k=>{if(/^bh_course_|^bh_portal_v1|_queue$/.test(k))localStorage.removeItem(k)})}catch(e){}}
 async function getProgress(code){const s=await session();if(!s)return null;
  const{data}=await client().from("course_progress").select("state,updated_at,cycle_start").eq("user_id",s.user.id).eq("course_code",code).maybeSingle();return data||null}
 const timers={},pending={};
 function cloudCopy(state){const c=JSON.parse(JSON.stringify(state||{}));if(c.done)delete c.done.sig;delete c.user;return c}
 function putProgress(code,state){if(!uid)return;pending[code]={state:cloudCopy(state),uid};clearTimeout(timers[code]);timers[code]=setTimeout(()=>flush(code),1200)}
 function beacon(){if(!tok)return;Object.keys(pending).forEach(code=>{const it=pending[code];if(it.uid!==uid)return;try{fetch(URL+"/rest/v1/course_progress?on_conflict=user_id,course_code",{method:"POST",keepalive:true,headers:{apikey:KEY,Authorization:"Bearer "+tok,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({user_id:it.uid,course_code:code,state:it.state,updated_at:new Date().toISOString()})});delete pending[code];clearTimeout(timers[code])}catch(e){}})}
 async function flushAll(){await Promise.all(Object.keys(pending).map(flush))}
 async function flush(code){const it=pending[code];if(!it)return;delete pending[code];clearTimeout(timers[code]);const s=await session();if(!s||s.user.id!==it.uid)return;
  try{const{error}=await client().from("course_progress").upsert({user_id:it.uid,course_code:code,state:it.state,updated_at:new Date().toISOString()},{onConflict:"user_id,course_code"});if(error)pending[code]=pending[code]||it}catch(e){pending[code]=pending[code]||it}}
 window.addEventListener("pagehide",beacon);document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")beacon()});
 window.addEventListener("online",()=>{flushAll();retryCompletions()});
 const CQ="bh_course_completion_queue";
 function cq(){try{return JSON.parse(localStorage.getItem(CQ)||"[]")}catch(e){return[]}}
 function cqSet(a){try{a.length?localStorage.setItem(CQ,JSON.stringify(a)):localStorage.removeItem(CQ)}catch(e){}}
 async function retryCompletions(){const s=await session();if(!s)return;const q=cq();if(!q.length)return;const left=[];for(const it of q){if(it.uid!==s.user.id){left.push(it);continue}const{error}=await client().from("completions").insert(it.row);if(error)left.push(it)}cqSet(left)}
 async function addCompletion(r){const s=await session();if(!s)return false;
  const row={user_id:s.user.id,course_code:r.code,course_title:r.title,hours:parseFloat(r.hours)||0,completed_at:r.completed_at||new Date().toISOString(),score:r.score==null||r.score===""?null:+r.score,total:r.total||null,attempt:r.attempt||null,answers:r.answers||null,acknowledgment:r.ack||null,source:r.source||"portal",trainer:r.trainer?String(r.trainer).slice(0,120):null,file_path:r.file_path||null};
  let ok=false;try{const{error}=await client().from("completions").insert(row);ok=!error}catch(e){}
  if(!ok){const q=cq();q.push({uid:s.user.id,row});cqSet(q)}return ok}
 async function myCompletions(){const s=await session();if(!s)return[];
  const{data}=await client().from("completions").select("course_code,course_title,hours,completed_at,score,total,source,verified_by,trainer,file_path").eq("user_id",s.user.id).eq("voided",false).order("completed_at",{ascending:false});return data||[]}
 async function myLegacy(){const s=await session();if(!s)return[];try{const{data,error}=await client().rpc("my_legacy_training");return error?[]:(data||[])}catch(e){return[]}}
 /* one activity entry per page per day, so staff can see who has been in and how often */
 async function visit(){const s=await session();if(!s)return;const k="bh_course_visits";let m={};try{m=JSON.parse(localStorage.getItem(k)||"{}")}catch(e){}
  const day=new Date().toDateString(),key=s.user.id+"|"+location.pathname;if(m[key]===day)return;m[key]=day;try{localStorage.setItem(k,JSON.stringify(m))}catch(e){}log("visit",location.pathname)}
 /* certificate upload into the person's own private folder; returns the stored path */
 async function uploadCert(file,code,forUser){const s=await session();if(!s||!file)return null;const nm=(file.name||"").toLowerCase();const TYPES={pdf:"application/pdf",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",heic:"image/heic",heif:"image/heic",webp:"image/webp"};
  let ext=nm.includes(".")?nm.split(".").pop().replace(/[^a-z0-9]/g,""):"";if(!TYPES[ext])ext=({"application/pdf":"pdf","image/jpeg":"jpg","image/png":"png","image/heic":"heic","image/heif":"heic","image/webp":"webp"})[file.type]||"";if(!ext)throw new Error("Please upload a PDF or a photo (JPG, PNG or HEIC).");
  const path=(forUser||s.user.id)+"/"+String(code).replace(/[^A-Za-z0-9-]/g,"")+"-"+Date.now()+"."+ext;
  const{error}=await client().storage.from("certificates").upload(path,file,{upsert:false,contentType:TYPES[ext]});if(error)throw error;return path}
 async function log(action,target){const s=await session();if(!s)return;try{await client().from("access_log").insert({actor:s.user.id,action,target:target||null})}catch(e){}}
 return{available,client,session,profile,asUser,sendCode,verify,saveProfile,signOut,clearLocal,getProgress,putProgress,flush,flushAll,addCompletion,retryCompletions,myCompletions,myLegacy,visit,uploadCert,log}
})();

/* Shared sign-in panel used by the portal home and the courses.
   host: element to render into. onDone(user): called once signed in. */
window.BHSignIn=function(host,onDone,opts){
 opts=opts||{};const roles=opts.roles||["Foster Caregiver","Kinship Caregiver","Adoptive Parent","Foster and Adoptive Caregiver","Staff","Contracted Provider"];
 const e=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
 let email="",meta={};
 function step1(msg){host.innerHTML=`<div class="bhs"><h2>Sign in to save your place</h2><p class="bhs-sub">We email you a sign-in code. No password to remember. Your place is saved, so you can stop and finish later on any phone or computer.</p>
  <div class="bhs-row"><div><label for="bhsName">Full name</label><input id="bhsName" type="text" autocomplete="name" placeholder="First and last name"></div><div><label for="bhsEmail">Email</label><input id="bhsEmail" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com"></div></div>
  <div class="bhs-row"><div><label for="bhsHome">Foster home or staff role</label><input id="bhsHome" type="text" placeholder="e.g., Johnson Home, or Case Manager"></div><div><label for="bhsRole">I am a</label><select id="bhsRole">${roles.map(r=>`<option>${e(r)}</option>`).join("")}</select></div></div>
  ${msg?`<p class="bhs-note">${e(msg)}</p>`:""}<p class="bhs-err" id="bhsErr"></p><p><button class="btn" id="bhsSend" type="button">Email me a code</button></p>
  <p class="bhs-fine">Already signed in before? Just enter your email; your name and home are kept on file.</p></div>`;
  const go=async()=>{const n=host.querySelector("#bhsName").value.trim(),em=host.querySelector("#bhsEmail").value.trim().toLowerCase(),hm=host.querySelector("#bhsHome").value.trim(),r=host.querySelector("#bhsRole").value;
   const err=host.querySelector("#bhsErr");if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){err.textContent="Please enter a valid email address.";return}
   const b=host.querySelector("#bhsSend");b.disabled=true;b.textContent="Sending…";email=em;meta={full_name:n,home_label:hm,caregiver_type:r};
   try{await BHC.sendCode(em,meta);step2()}catch(x){if(x&&(x.status===403||x.status===422||/not set up|not allowed|signups/i.test(x.message||""))){step2();return}b.disabled=false;b.textContent="Email me a code";
    err.textContent=/rate|security purposes|seconds/i.test(x&&x.message||"")?"A code was just sent. Please wait a minute, then try again.":"We could not send the code just now. Check your connection and try again."}};
  host.querySelector("#bhsSend").onclick=go;host.querySelectorAll("input").forEach(i=>i.addEventListener("keydown",ev=>{if(ev.key==="Enter")go()}))}
 function step2(msg){host.innerHTML=`<div class="bhs"><h2>Check your email</h2><p class="bhs-sub">If <b>${e(email)}</b> is set up with Benevolent House, a sign-in code from Benevolent House Training is on its way. It can take a minute; check your spam or junk folder too. No code after five minutes? Call Benevolent House at (214) 774-4871 so we can add you.</p>
  <label for="bhsCode">Your sign-in code</label><input id="bhsCode" class="bhs-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="Code from email">
  <p class="bhs-err" id="bhsErr">${e(msg||"")}</p><p><button class="btn" id="bhsVerify" type="button">Sign in</button> <button class="btn ghost" id="bhsBack" type="button">Use a different email</button></p>
  <p class="bhs-fine">You can also tap the link in the email if you opened it on this same device.</p></div>`;
  const code=host.querySelector("#bhsCode");code.focus();
  const go=async()=>{const t=code.value.replace(/\D/g,"");const err=host.querySelector("#bhsErr");if(t.length<6){err.textContent="Please enter the full code from your email.";return}
   const b=host.querySelector("#bhsVerify");b.disabled=true;b.textContent="Checking…";
   try{await BHC.verify(email,t);let p=await BHC.profile(true);for(let i=0;!p&&i<4;i++){await new Promise(r=>setTimeout(r,700));p=await BHC.profile(true)}if(!p)throw new Error("noprofile");
    const upd={};if(meta.full_name&&!p.full_name)upd.name=meta.full_name;if(meta.home_label&&!p.home_label)upd.home=meta.home_label;if(meta.caregiver_type&&!p.caregiver_type)upd.role=meta.caregiver_type;
    if(Object.keys(upd).length)p=await BHC.saveProfile(upd)||p;BHC.log("sign_in",location.pathname);
    if(!p.full_name||!p.home_label){step3(p);return}onDone(BHC.asUser(p))}
   catch(x){b.disabled=false;b.textContent="Sign in";if(x&&x.message==="noprofile"){await BHC.signOut();err.textContent="We could not find an active Benevolent House training account for this email. If you believe this is an error, please contact Benevolent House at (214) 774-4871.";return}err.textContent=(x&&x.unavailable)?"You are signed in, but your record could not be loaded. Check your connection and refresh the page.":"That code did not work. Check the newest email and try again, or ask for a new code."}};
  host.querySelector("#bhsVerify").onclick=go;code.addEventListener("keydown",ev=>{if(ev.key==="Enter")go()});host.querySelector("#bhsBack").onclick=()=>step1()}
 function step3(p){host.innerHTML=`<div class="bhs"><h2>One more step</h2><p class="bhs-sub">You are signed in. Tell us your name and home so your certificates and training log are correct.</p>
  <div class="bhs-row"><div><label for="bhsName">Full name</label><input id="bhsName" type="text" autocomplete="name" value="${e(p.full_name||"")}"></div><div><label for="bhsHome">Foster home or staff role</label><input id="bhsHome" type="text" value="${e(p.home_label||"")}" placeholder="e.g., Johnson Home, or Case Manager"></div></div>
  <label for="bhsRole">I am a</label><select id="bhsRole">${roles.map(r=>`<option ${r===p.caregiver_type?"selected":""}>${e(r)}</option>`).join("")}</select>
  <p class="bhs-err" id="bhsErr"></p><p><button class="btn" id="bhsSave" type="button">Save and continue</button></p></div>`;
  host.querySelector("#bhsSave").onclick=async()=>{const n=host.querySelector("#bhsName").value.trim(),hm=host.querySelector("#bhsHome").value.trim(),r=host.querySelector("#bhsRole").value;
   if(!n||!hm){host.querySelector("#bhsErr").textContent="Please fill in your name and home or role.";return}
   const q=await BHC.saveProfile({name:n,home:hm,role:r});onDone(BHC.asUser(q||Object.assign(p,{full_name:n,home_label:hm,caregiver_type:r})))}}
 if(opts.profile){step3(opts.profile);return}
 step1(opts.message);const pf=opts.prefill||{};[["bhsName",pf.name],["bhsEmail",pf.email],["bhsHome",pf.home]].forEach(([id,v])=>{const el=host.querySelector("#"+id);if(el&&v)el.value=v});if(pf.role){const sel=host.querySelector("#bhsRole");if(sel)sel.value=pf.role}};
window.BHSignInCSS=`.bhs h2{margin:0 0 6px}.bhs-sub{margin:0 0 14px;color:inherit;opacity:.85}.bhs-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:640px){.bhs-row{grid-template-columns:1fr}}.bhs label{display:block;font-weight:600;margin:10px 0 4px}.bhs input,.bhs select{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid #c9c2b4;border-radius:8px;background:#fff;color:#1f2a24}.bhs-code{font-size:1.6rem;letter-spacing:.35em;max-width:240px;text-align:center}.bhs-err{color:#a33a2a;min-height:1.2em;margin:8px 0 0;font-weight:600}.bhs-fine{font-size:.88rem;opacity:.75}.bhs-note{background:#FFF4D6;color:#5c4500;border-radius:8px;padding:10px 12px;margin:12px 0 0;font-weight:600}`;
(function(){try{const s=document.createElement("style");s.textContent=window.BHSignInCSS;document.head.appendChild(s)}catch(e){}})();

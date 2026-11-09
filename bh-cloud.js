/* Benevolent House portal: sign-in and saved records (Supabase). Loaded by the portal home and every course. */
window.BHC=(function(){
 const URL="https://vlnkonohruekslfoazzx.supabase.co";
 const KEY="sb_publishable_Q2sWd7f1pxDzDhpjPBgrZQ_MJolelnk";
 let sb=null,me=null,meLoaded=false;
 function client(){
  if(sb)return sb;
  if(!window.supabase||!window.supabase.createClient)return null;
  try{sb=window.supabase.createClient(URL,KEY,{auth:{flowType:"implicit",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:"bh-portal-auth"}})}catch(e){sb=null}
  return sb}
 function available(){return !!client()}
 async function session(){const c=client();if(!c)return null;try{const{data}=await c.auth.getSession();return data.session||null}catch(e){return null}}
 async function profile(force){
  if(meLoaded&&!force)return me;
  const s=await session();if(!s){me=null;meLoaded=true;return null}
  const{data,error}=await client().from("profiles").select("id,email,full_name,role,caregiver_type,home_label,home_id").eq("id",s.user.id).maybeSingle();
  me=error?null:data;meLoaded=true;return me}
 function asUser(p){return p?{name:p.full_name||"",email:p.email||"",home:p.home_label||"",role:p.caregiver_type||"",cloud:true,id:p.id,access:p.role}:null}
 async function sendCode(email,meta){const c=client();if(!c)throw new Error("offline");
  const{error}=await c.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:location.origin+location.pathname,data:meta||{}}});
  if(error)throw error;return true}
 async function verify(email,token){const c=client();const{data,error}=await c.auth.verifyOtp({email,token:String(token).replace(/\D/g,""),type:"email"});if(error)throw error;meLoaded=false;return data}
 async function saveProfile(f){const s=await session();if(!s)return null;const row={};
  if(f.name!=null)row.full_name=f.name;if(f.home!=null)row.home_label=f.home;if(f.role!=null)row.caregiver_type=f.role;
  const{data,error}=await client().from("profiles").update(row).eq("id",s.user.id).select().maybeSingle();if(!error&&data){me=data;meLoaded=true}return data}
 async function signOut(){const c=client();me=null;meLoaded=true;if(c){try{await c.auth.signOut()}catch(e){}}}
 async function getProgress(code){const s=await session();if(!s)return null;
  const{data}=await client().from("course_progress").select("state,updated_at,cycle_start").eq("user_id",s.user.id).eq("course_code",code).maybeSingle();return data||null}
 const timers={},pending={};
 function putProgress(code,state){pending[code]=state;clearTimeout(timers[code]);timers[code]=setTimeout(()=>flush(code),1200)}
 async function flush(code){const state=pending[code];if(!state)return;delete pending[code];const s=await session();if(!s)return;
  try{await client().from("course_progress").upsert({user_id:s.user.id,course_code:code,state,updated_at:new Date().toISOString()},{onConflict:"user_id,course_code"})}catch(e){pending[code]=pending[code]||state}}
 window.addEventListener("pagehide",()=>{Object.keys(pending).forEach(flush)});
 async function addCompletion(r){const s=await session();if(!s)return false;
  const row={user_id:s.user.id,course_code:r.code,course_title:r.title,hours:parseFloat(r.hours)||0,completed_at:r.completed_at||new Date().toISOString(),score:r.score==null||r.score===""?null:+r.score,total:r.total||null,attempt:r.attempt||null,answers:r.answers||null,acknowledgment:r.ack||null,source:r.source||"portal"};
  const{error}=await client().from("completions").insert(row);return !error}
 async function myCompletions(){const s=await session();if(!s)return[];
  const{data}=await client().from("completions").select("course_code,course_title,hours,completed_at,score,total,source,verified_by").eq("user_id",s.user.id).order("completed_at",{ascending:false});return data||[]}
 async function log(action,target){const s=await session();if(!s)return;try{await client().from("access_log").insert({actor:s.user.id,action,target:target||null})}catch(e){}}
 return{available,client,session,profile,asUser,sendCode,verify,saveProfile,signOut,getProgress,putProgress,flush,addCompletion,myCompletions,log}
})();

/* Shared sign-in panel used by the portal home and the courses.
   host: element to render into. onDone(user): called once signed in. */
window.BHSignIn=function(host,onDone,opts){
 opts=opts||{};const roles=opts.roles||["Foster Caregiver","Kinship Caregiver","Adoptive Parent","Foster and Adoptive Caregiver","Staff","Contracted Provider"];
 const e=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
 let email="",meta={};
 function step1(msg){host.innerHTML=`<div class="bhs"><h2>Sign in to save your place</h2><p class="bhs-sub">We email you a 6-digit code. No password to remember. Your place is saved, so you can stop and finish later on any phone or computer.</p>
  <div class="bhs-row"><div><label for="bhsName">Full name</label><input id="bhsName" type="text" autocomplete="name" placeholder="First and last name"></div><div><label for="bhsEmail">Email</label><input id="bhsEmail" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com"></div></div>
  <div class="bhs-row"><div><label for="bhsHome">Foster home or staff role</label><input id="bhsHome" type="text" placeholder="e.g., Johnson Home, or Case Manager"></div><div><label for="bhsRole">I am a</label><select id="bhsRole">${roles.map(r=>`<option>${e(r)}</option>`).join("")}</select></div></div>
  <p class="bhs-err" id="bhsErr">${e(msg||"")}</p><p><button class="btn" id="bhsSend" type="button">Email me a code</button></p>
  <p class="bhs-fine">Already signed in before? Just enter your email; your name and home are kept on file. Benevolent House keeps your name and training records for licensing and T3C credentialing. No child information is entered here.</p></div>`;
  const go=async()=>{const n=host.querySelector("#bhsName").value.trim(),em=host.querySelector("#bhsEmail").value.trim().toLowerCase(),hm=host.querySelector("#bhsHome").value.trim(),r=host.querySelector("#bhsRole").value;
   const err=host.querySelector("#bhsErr");if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){err.textContent="Please enter a valid email address.";return}
   const b=host.querySelector("#bhsSend");b.disabled=true;b.textContent="Sending…";email=em;meta={full_name:n,home_label:hm,caregiver_type:r};
   try{await BHC.sendCode(em,meta);step2()}catch(x){b.disabled=false;b.textContent="Email me a code";
    err.textContent=/rate|security purposes|seconds/i.test(x&&x.message||"")?"A code was just sent. Please wait a minute, then try again.":"We could not send the code just now. Check your connection and try again."}};
  host.querySelector("#bhsSend").onclick=go;host.querySelectorAll("input").forEach(i=>i.addEventListener("keydown",ev=>{if(ev.key==="Enter")go()}))}
 function step2(msg){host.innerHTML=`<div class="bhs"><h2>Check your email</h2><p class="bhs-sub">We sent a 6-digit code to <b>${e(email)}</b> from Benevolent House Training. It can take a minute. If you do not see it, check your spam or junk folder.</p>
  <label for="bhsCode">Your 6-digit code</label><input id="bhsCode" class="bhs-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="123456">
  <p class="bhs-err" id="bhsErr">${e(msg||"")}</p><p><button class="btn" id="bhsVerify" type="button">Sign in</button> <button class="btn ghost" id="bhsBack" type="button">Use a different email</button></p>
  <p class="bhs-fine">You can also tap the link in the email if you opened it on this same device.</p></div>`;
  const code=host.querySelector("#bhsCode");code.focus();
  const go=async()=>{const t=code.value.replace(/\D/g,"");const err=host.querySelector("#bhsErr");if(t.length<6){err.textContent="Please enter the 6-digit code.";return}
   const b=host.querySelector("#bhsVerify");b.disabled=true;b.textContent="Checking…";
   try{await BHC.verify(email,t);let p=await BHC.profile(true);
    const upd={};if(meta.full_name&&!p.full_name)upd.name=meta.full_name;if(meta.home_label&&!p.home_label)upd.home=meta.home_label;if(meta.caregiver_type&&!p.caregiver_type)upd.role=meta.caregiver_type;
    if(meta.full_name&&p.full_name&&meta.full_name!==p.full_name)upd.name=meta.full_name;if(meta.home_label&&p.home_label&&meta.home_label!==p.home_label)upd.home=meta.home_label;
    if(Object.keys(upd).length)p=await BHC.saveProfile(upd)||p;BHC.log("sign_in",location.pathname);
    if(!p.full_name||!p.home_label){step3(p);return}onDone(BHC.asUser(p))}
   catch(x){b.disabled=false;b.textContent="Sign in";err.textContent="That code did not work. Check the newest email and try again, or ask for a new code."}};
  host.querySelector("#bhsVerify").onclick=go;code.addEventListener("keydown",ev=>{if(ev.key==="Enter")go()});host.querySelector("#bhsBack").onclick=()=>step1()}
 function step3(p){host.innerHTML=`<div class="bhs"><h2>One more step</h2><p class="bhs-sub">You are signed in. Tell us your name and home so your certificates and training log are correct.</p>
  <div class="bhs-row"><div><label for="bhsName">Full name</label><input id="bhsName" type="text" autocomplete="name" value="${e(p.full_name||"")}"></div><div><label for="bhsHome">Foster home or staff role</label><input id="bhsHome" type="text" value="${e(p.home_label||"")}" placeholder="e.g., Johnson Home, or Case Manager"></div></div>
  <label for="bhsRole">I am a</label><select id="bhsRole">${roles.map(r=>`<option ${r===p.caregiver_type?"selected":""}>${e(r)}</option>`).join("")}</select>
  <p class="bhs-err" id="bhsErr"></p><p><button class="btn" id="bhsSave" type="button">Save and continue</button></p></div>`;
  host.querySelector("#bhsSave").onclick=async()=>{const n=host.querySelector("#bhsName").value.trim(),hm=host.querySelector("#bhsHome").value.trim(),r=host.querySelector("#bhsRole").value;
   if(!n||!hm){host.querySelector("#bhsErr").textContent="Please fill in your name and home or role.";return}
   const q=await BHC.saveProfile({name:n,home:hm,role:r});onDone(BHC.asUser(q||Object.assign(p,{full_name:n,home_label:hm,caregiver_type:r})))}}
 step1(opts.message)};
window.BHSignInCSS=`.bhs h2{margin:0 0 6px}.bhs-sub{margin:0 0 14px;color:inherit;opacity:.85}.bhs-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:640px){.bhs-row{grid-template-columns:1fr}}.bhs label{display:block;font-weight:600;margin:10px 0 4px}.bhs input,.bhs select{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid #c9c2b4;border-radius:8px;background:#fff;color:#1f2a24}.bhs-code{font-size:1.6rem;letter-spacing:.35em;max-width:240px;text-align:center}.bhs-err{color:#a33a2a;min-height:1.2em;margin:8px 0 0;font-weight:600}.bhs-fine{font-size:.88rem;opacity:.75}`;
(function(){try{const s=document.createElement("style");s.textContent=window.BHSignInCSS;document.head.appendChild(s)}catch(e){}})();

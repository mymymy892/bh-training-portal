/* Benevolent House training reminders: who is due for what, and which reminder goes out today.
   Shared by the admin page (to preview) and the daily reminder job in Supabase (to send).
   Needs catalog.js loaded first. Dates are counted in Central time. */
(function(){
 const W=typeof window!=="undefined"?window:globalThis;
 const FAMILY_MARKS=[60,30,14,7,2,1,0];   /* days before the due date that a person is emailed */
 const STAFF_MARKS=[30,14,1];             /* days before the due date that staff get a list */
 const nm=t=>String(t||"").trim().toLowerCase().replace(/\s+/g," ");
 function ymd(d){const p=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);const g=k=>p.find(x=>x.type===k).value;return g("year")+"-"+g("month")+"-"+g("day")}
 function dayNum(s){const[a,b,c]=s.split("-").map(Number);return Date.UTC(a,b-1,c)/864e5}
 function marksFor(c){const w=+(c.window)||60;return FAMILY_MARKS.filter(m=>m<=w)}
 const CATCH_UP=2; /* if a day was missed, the reminder still goes out up to 2 days late */
 /* people: approved_people rows; profiles; comps: completions; legacy: legacy_training rows */
 function plan(o){const CAT=o.catalog||W.CATALOG;const now=o.now||new Date();const today=ymd(now);const t0=dayNum(today);
  const profByEmail={};(o.profiles||[]).forEach(p=>{profByEmail[nm(p.email)]=p});
  const nameCount={};(o.people||[]).forEach(a=>{if(a.active&&a.full_name){const k=nm(a.full_name);nameCount[k]=(nameCount[k]||0)+1}});
  const legByName={};(o.legacy||[]).forEach(l=>{if(l.voided)return;(legByName[nm(l.person_name)]=legByName[nm(l.person_name)]||[]).push(l)});
  const compsBy={};(o.comps||[]).forEach(r=>{if(!r.voided)(compsBy[r.user_id]=compsBy[r.user_id]||[]).push(r)});
  const out=[];
  (o.people||[]).filter(a=>a.active&&a.email).forEach(a=>{const prof=profByEmail[nm(a.email)];const type=(prof&&prof.caregiver_type)||a.caregiver_type||(a.access==="caregiver"?"Foster Caregiver":"Staff");
   const name=(prof&&prof.full_name)||a.full_name||"";const latest={};
   const add=(code,iso)=>{if(!latest[code]||new Date(iso)>new Date(latest[code]))latest[code]=iso};
   if(prof)(compsBy[prof.id]||[]).forEach(r=>add(r.course_code,r.completed_at));
   if(a.full_name&&nameCount[nm(a.full_name)]===1)(legByName[nm(a.full_name)]||[]).forEach(l=>add(l.course_code,l.completed_on+"T18:00:00Z"));
   CAT.forEach(c=>{if(!W.BH_FOR(c,type))return;const iso=latest[c.code];if(!iso&&c.cycle!=="quarter")return;
    const due=W.BH_DUE(c,iso||null,now);if(!due)return;const dueStr=ymd(due);const days=dayNum(dueStr)-t0;
    const marks=marksFor(c).filter(m=>m>=days&&m-days<=CATCH_UP);
    out.push({email:nm(a.email),name,home:(prof&&prof.home_label)||a.home_label||"",type,code:c.code,title:c.title,link:c.link||"",linkLabel:c.linkLabel||"Go to the training",linkNote:c.linkNote||"",status:c.status,hours:c.hours,due:dueStr,days,
     window:+(c.window)||60,marks,staff:STAFF_MARKS.includes(days)})})});
  return{today,items:out}}
 function fmtLong(s){const[a,b,c]=s.split("-").map(Number);return new Date(Date.UTC(a,b-1,c,12)).toLocaleDateString("en-US",{timeZone:"UTC",month:"long",day:"numeric",year:"numeric"})}
 const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const PORTAL="https://portal.benevolenthouse.org/";
 function when(d){return d<0?"past due":d===0?"today":d===1?"tomorrow":"in "+d+" days"}
 const joinNames=a=>{a=[...new Set(a.filter(Boolean))];return a.length<2?(a[0]||""):a.slice(0,-1).join(", ")+" and "+a[a.length-1]};
 /* one email per email address. hit(item) says whether an item reaches a reminder day (the sender passes only marks not yet sent).
    Each email also lists anything else for that address coming due soon, so families get fewer, fuller emails. */
 function familyEmails(p,hit){hit=hit||(i=>i.marks.length>0);const by={};p.items.forEach(i=>{(by[i.email]=by[i.email]||[]).push(i)});const out=[];
  Object.entries(by).forEach(([email,all])=>{const hits=all.filter(hit);if(!hits.length)return;
   const extra=all.filter(i=>!hits.includes(i)&&i.days>=0&&i.days<=Math.min(30,i.window));
   const merge=list=>{const m={};list.forEach(i=>{const k=i.code+"|"+i.due;(m[k]=m[k]||Object.assign({},i,{names:[]})).names.push(i.name)});return Object.values(m).sort((x,y)=>x.days-y.days)};
   const main=merge(hits),more=merge(extra);const names=joinNames(all.map(i=>i.name));const soonest=main[0];
   const onlyCheck=main.every(i=>i.code==="CWB");const what=onlyCheck?"check-in":(main.length===1?"training":"trainings");
   const subject=`${soonest.days===0?"Due today":"Due "+fmtLong(soonest.due)}: Benevolent House ${main.length===1?soonest.title:main.length+" "+what}${names?" for "+names:""}`;
   const li=i=>`<li style="margin:0 0 12px"><b>${esc(i.title)}</b>${i.names.filter(Boolean).length&&new Set(all.map(x=>x.name)).size>1?` <span style="color:#6B5F58">(${esc(joinNames(i.names))})</span>`:""}<br>Due ${esc(when(i.days))}${i.days>0?`, by ${esc(fmtLong(i.due))}`:""}${i.hours?` · ${esc(i.hours)} training hour${i.hours==1?"":"s"}`:""}<br>${i.code==="CPR"?`You can recertify with Benevolent House ($40 per caregiver, taught by our HSI-certified trainers). Choose "Schedule with Benevolent House" in the <a href="${PORTAL}">training portal</a>, or complete it with another provider and add your date there.`:i.link?`<a href="${esc(i.link)}">${esc(i.linkLabel)}</a>${i.linkNote?" · "+esc(i.linkNote):""}`:i.status==="live"?`<a href="${PORTAL}">Take it in the training portal</a>`:`Benevolent House will send you the materials, or ask your case manager. When you finish, add your date in the <a href="${PORTAL}">training portal</a>.`}</li>`;
   const html=`<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#2B2320;max-width:600px">
<p>Hello,</p>
<p>This is a reminder from Benevolent House${names?` for <b>${esc(names)}</b>`:""} about ${main.length===1?`a ${what} that is`:`${what} that are`} coming due.</p>
<ul style="padding-left:20px">${main.map(li).join("")}</ul>${more.length?`<p style="margin-bottom:6px"><b>Also coming up</b></p><ul style="padding-left:20px">${more.map(li).join("")}</ul>`:""}
<p>When you finish, add your completion date in the <a href="${PORTAL}">Benevolent House Training Portal</a> so your training log stays current. If you already completed ${main.length+more.length===1?"it":"these"}, please add the date there or reply to this email and we will update your record.</p>
<p>Questions? Reply to this email or call the office at (214) 774-4871.</p>
<p>Thank you,<br>Benevolent House</p>
<p style="font-size:12px;color:#6B5F58">You receive these reminders because you are a Benevolent House caregiver or staff member. Replies go to Ms. Orr and Ms. Mashburn.</p></div>`;
   out.push({to:email,subject,html,items:hits})});return out}
 /* one list for staff: who reaches 30 days, 2 weeks or 1 day before a due date today; on Mondays, everything past due too */
 function staffEmail(p){const list=p.items.filter(i=>i.staff);const monday=new Date(p.today+"T12:00:00Z").getUTCDay()===1;const past=monday?p.items.filter(i=>i.days<0):[];if(!list.length&&!past.length)return null;
  const section=(label,g)=>{if(!g.length)return "";const by={};g.forEach(i=>{const k=i.email;(by[k]=by[k]||{name:i.name,email:i.email,home:i.home,items:[]}).items.push(i)});
   const rows=Object.values(by).sort((a,b)=>(a.home||"~").localeCompare(b.home||"~")||(a.name||"~").localeCompare(b.name||"~"));
   return `<h3 style="color:#7B4B2A;margin:18px 0 6px">${label} (${rows.length} ${rows.length===1?"person":"people"})</h3><table style="border-collapse:collapse;width:100%;font-size:14px">${rows.map(r=>`<tr><td style="border-bottom:1px solid #E3D7C9;padding:6px 8px;vertical-align:top;width:40%"><b>${esc(r.name||r.email)}</b><br><span style="color:#6B5F58">${esc([r.home,r.name?r.email:""].filter(Boolean).join(" · "))}</span></td><td style="border-bottom:1px solid #E3D7C9;padding:6px 8px">${r.items.map(i=>`${esc(i.title)} <span style="color:#6B5F58">(due ${esc(fmtLong(i.due))})</span>`).join("<br>")}</td></tr>`).join("")}</table>`};
  const groups=[[30,"Due in 30 days"],[14,"Due in 2 weeks"],[1,"Due tomorrow"]];
  const body=groups.map(([d,l])=>section(l,list.filter(i=>i.days===d))).join("")+section("Past due (Monday list)",past);
  const n=list.length+past.length;
  return{subject:`Benevolent House training due list for ${fmtLong(p.today)}`,html:`<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.45;color:#2B2320;max-width:720px"><p>These trainings reach 30 days, 2 weeks or 1 day before their due date today${past.length?", and on Mondays the list also shows everything past due":""}. Families receive their own reminder emails.</p>${body}<p style="margin-top:18px">See everyone's records in <a href="${PORTAL}admin/">Training Admin</a>.</p></div>`,items:list.concat(past),count:n}}
 W.BH_REMIND={plan,familyEmails,staffEmail,ymd,fmtLong,FAMILY_MARKS,STAFF_MARKS,CATCH_UP};
})();

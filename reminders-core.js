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
 /* people: approved_people rows; profiles; comps: completions; legacy: legacy_training rows */
 function plan(o){const CAT=o.catalog||W.CATALOG;const now=o.now||new Date();const today=ymd(now);const t0=dayNum(today);
  const profByEmail={};(o.profiles||[]).forEach(p=>{profByEmail[nm(p.email)]=p});
  const nameCount={};(o.people||[]).forEach(a=>{if(a.active&&a.full_name){const k=nm(a.full_name);nameCount[k]=(nameCount[k]||0)+1}});
  const legByName={};(o.legacy||[]).forEach(l=>{(legByName[nm(l.person_name)]=legByName[nm(l.person_name)]||[]).push(l)});
  const compsBy={};(o.comps||[]).forEach(r=>{if(!r.voided)(compsBy[r.user_id]=compsBy[r.user_id]||[]).push(r)});
  const out=[];
  (o.people||[]).filter(a=>a.active&&a.email).forEach(a=>{const prof=profByEmail[nm(a.email)];const type=(prof&&prof.caregiver_type)||a.caregiver_type||(a.access==="caregiver"?"Foster Caregiver":"Staff");
   const name=(prof&&prof.full_name)||a.full_name||"";const latest={};
   const add=(code,iso)=>{if(!latest[code]||new Date(iso)>new Date(latest[code]))latest[code]=iso};
   if(prof)(compsBy[prof.id]||[]).forEach(r=>add(r.course_code,r.completed_at));
   if(a.full_name&&nameCount[nm(a.full_name)]===1)(legByName[nm(a.full_name)]||[]).forEach(l=>add(l.course_code,l.completed_on+"T18:00:00Z"));
   CAT.forEach(c=>{if(!W.BH_FOR(c,type))return;const iso=latest[c.code];if(!iso&&c.cycle!=="quarter")return;
    const due=W.BH_DUE(c,iso||null,now);if(!due)return;const dueStr=ymd(due);const days=dayNum(dueStr)-t0;
    out.push({email:nm(a.email),name,home:(prof&&prof.home_label)||a.home_label||"",type,code:c.code,title:c.title,link:c.link||"",linkNote:c.linkNote||"",status:c.status,hours:c.hours,due:dueStr,days,
     family:marksFor(c).includes(days),staff:STAFF_MARKS.includes(days)})})});
  return{today,items:out}}
 function fmtLong(s){const[a,b,c]=s.split("-").map(Number);return new Date(Date.UTC(a,b-1,c,12)).toLocaleDateString("en-US",{timeZone:"UTC",month:"long",day:"numeric",year:"numeric"})}
 const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const PORTAL="https://portal.benevolenthouse.org/";
 function when(d){return d===0?"today":d===1?"tomorrow":"in "+d+" days"}
 /* one email per person, listing every training that reaches a reminder day today */
 function familyEmails(p){const by={};p.items.filter(i=>i.family).forEach(i=>{(by[i.email]=by[i.email]||[]).push(i)});
  return Object.entries(by).map(([email,list])=>{list.sort((x,y)=>x.days-y.days);const first=(list[0].name||"").split(" ")[0];
   const who=list[0].name?" for "+list[0].name:"";const subject=list.length===1?`Benevolent House training reminder${who}: ${list[0].title} is due ${fmtLong(list[0].due)}`:`Benevolent House training reminder${who}: ${list.length} trainings due soon`;
   const rows=list.map(i=>`<li style="margin:0 0 12px"><b>${esc(i.title)}</b><br>Due ${esc(when(i.days))}, by ${esc(fmtLong(i.due))}${i.hours?` · ${esc(i.hours)} training hour${i.hours==1?"":"s"}`:""}<br>${i.link?`<a href="${esc(i.link)}">Go to the training</a>${i.linkNote?" · "+esc(i.linkNote):""}`:i.status==="live"?`<a href="${PORTAL}">Take it in the training portal</a>`:`Ask your case manager how to complete it, then add your date in the <a href="${PORTAL}">training portal</a>.`}</li>`).join("");
   const html=`<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#2B2320;max-width:600px">
<p>${first?`Hello ${esc(first)},`:"Hello,"}</p>
<p>This is a reminder from Benevolent House about ${list.length===1?"a training that is":"trainings that are"} coming due.</p>
<ul style="padding-left:20px">${rows}</ul>
<p>When you finish, add your completion date in the <a href="${PORTAL}">Benevolent House Training Portal</a> so your training log stays current. If you already completed ${list.length===1?"it":"these"}, please add the date there or reply to this email and we will update your record.</p>
<p>Questions? Reply to this email or call the office at (214) 774-4871.</p>
<p>Thank you,<br>Benevolent House</p>
<p style="font-size:12px;color:#6B5F58">You receive training reminders because you are a Benevolent House caregiver or staff member. Replies go to Ms. Orr and Ms. Mashburn.</p></div>`;
   return{to:email,subject,html,items:list}})}
 /* one list for staff: who reaches 30 days, 2 weeks or 1 day before a due date today */
 function staffEmail(p){const list=p.items.filter(i=>i.staff);if(!list.length)return null;const groups=[[30,"Due in 30 days"],[14,"Due in 2 weeks"],[1,"Due tomorrow"]];
  const body=groups.map(([d,label])=>{const g=list.filter(i=>i.days===d).sort((a,b)=>a.name.localeCompare(b.name));if(!g.length)return "";
   return `<h3 style="color:#7B4B2A;margin:18px 0 6px">${label} (${g.length})</h3><table style="border-collapse:collapse;width:100%;font-size:14px">${g.map(i=>`<tr><td style="border-bottom:1px solid #E3D7C9;padding:6px 8px"><b>${esc(i.name||i.email)}</b><br><span style="color:#6B5F58">${esc(i.home)} · ${esc(i.email)}</span></td><td style="border-bottom:1px solid #E3D7C9;padding:6px 8px">${esc(i.title)}<br><span style="color:#6B5F58">due ${esc(fmtLong(i.due))}</span></td></tr>`).join("")}</table>`}).join("");
  return{subject:`Training due list for ${fmtLong(p.today)}: ${list.length} item${list.length===1?"":"s"}`,html:`<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.45;color:#2B2320;max-width:720px"><p>These trainings reach 30 days, 2 weeks or 1 day before their due date today. Families also receive their own reminder emails.</p>${body}<p style="margin-top:18px">See everyone's records in <a href="${PORTAL}admin/">Training Admin</a>.</p></div>`,items:list}}
 W.BH_REMIND={plan,familyEmails,staffEmail,ymd,fmtLong,FAMILY_MARKS,STAFF_MARKS};
})();

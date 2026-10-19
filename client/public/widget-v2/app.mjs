import {assess,questions} from './rubric.mjs';
const $=id=>document.getElementById(id);
let loadedResearch=null,loadedOrigin='',busy=false,sourceCounter=0,activeController=null,runId=0;
let config=null,receiptToken=null,expiresAt=null,emailBusy=false;
for(const [i,q] of questions.entries()){
  const row=document.createElement('div');row.className='field question';
  const label=document.createElement('label');label.htmlFor=q.key;
  const number=document.createElement('span');number.className='qnumber';number.textContent=String(i+1).padStart(2,'0');
  label.append(number,document.createTextNode(q.question));
  const select=document.createElement('select');select.id=q.key;select.name=q.key;select.required=true;select.dataset.testid=`select-${q.key}`;select.setAttribute('aria-describedby',`${q.key}-error`);
  select.add(new Option('Select your answer',''));
  q.options.forEach((text,index)=>select.add(new Option(text,String(index))));
  select.add(new Option('Not sure','unknown'));
  const err=document.createElement('p');err.id=`${q.key}-error`;err.className='error';
  const caption=document.createElement('p');caption.id=`${q.key}-caption`;caption.className='helper selected-answer';
  select.setAttribute('aria-describedby',`${q.key}-error ${q.key}-caption`);
  row.append(label,select,caption,err);$('questions').append(row);
}
function setError(id,message){$(id).setAttribute('aria-invalid',String(!!message));$(`${id}-error`).textContent=message;}
function validWebsite(raw){
  try{const u=new URL(/^[a-z][a-z\d+.-]*:/i.test(raw)?raw:`https://${raw}`);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&u.hostname.includes('.')&&!/[\s<>]/.test(raw);}catch{return false;}
}
function validate(){
  const errors=[];
  for(const id of ['website','first','last','email','revenue',...questions.map(q=>q.key)]){
    let message='';const value=$(id).value.trim();
    if(!value) message=questions.some(q=>q.key===id)?'Choose an answer, including “Not sure” if needed.':'This field is required.';
    else if(id==='website'&&!validWebsite(value))message='Enter a website such as company.com or https://company.com.';
    else if(id==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))message='Enter a valid company email address.';
    else if(id==='email'&&config?.leadCapture?.personalEmailDomains?.includes(value.toLowerCase().split('@').at(-1)))message='Use your company email rather than a common personal-email address.';
    setError(id,message);if(message)errors.push(id);
  }
  if(errors.length){$('form-error').textContent='Please check the highlighted fields. Your other answers are kept.';$(errors[0]).focus();return false;}
  $('form-error').textContent='';return true;
}
function coverage(){const count=questions.filter(q=>['0','1','2'].includes($(q.key).value)).length;$('coverage').textContent=`${count} of 4 answered`;for(const q of questions){const s=$(q.key),text=s.selectedOptions[0].text;$(`${q.key}-caption`).textContent=s.value&&text.length>28?text:'';}}
$('snapshot-form').addEventListener('input',e=>{if(e.target.id&&$(`${e.target.id}-error`))setError(e.target.id,'');coverage();});
function renderScore(){
  const result=assess(Object.fromEntries(questions.map(q=>[q.key,$(q.key).value])));
  $('score').textContent=result.score===null?'Pending':String(result.score);
  $('denominator').hidden=result.score===null;
  $('score-status').textContent=result.status;
  $('entered').textContent=`Entered website: ${$('website').value.trim()} · ${result.known} of 4 readiness answers known`;
  $('next').textContent=result.next;
  $('breakdown').replaceChildren();
  for(const item of result.items){
    const box=document.createElement('div');box.className='bar-item';
    const name=document.createElement('b');name.textContent=item.name;
    const bar=document.createElement('progress');bar.max=2;bar.value=item.points??0;bar.setAttribute('aria-label',`${item.name}: ${item.points===null?'unknown':item.points+' of 2 points'}`);
    const points=document.createElement('span');points.textContent=item.points===null?'Not sure':`${item.points} / 2 points`;
    box.append(name,bar,points);$('breakdown').append(box);
  }
}
function sourceLink(source){
  const a=document.createElement('a');a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=source.title;a.dataset.testid=`link-source-${source.id}-${sourceCounter++}`;return a;
}
function renderBlock(container,block,label=''){
  container.replaceChildren();
  const p=document.createElement('p');p.textContent=block?.text||'Not established from the sources retrieved. Confirm this during discovery.';container.append(p);
  if(!block){p.className='missing-evidence';return;}
  const cites=document.createElement('div');cites.className='evidence citations';
  if(label){
    const cited=block.evidence.map(ev=>loadedResearch.sources.find(s=>s.id===ev.source_id)).filter(Boolean);
    const status=document.createElement('span');
    status.textContent=label==='Public-source finding'&&cited.length&&cited.every(s=>s.kind==='Company-published')?'Company-published statement':label;
    status.className='source-kind';cites.append(status);
  }
  for(const id of [...new Set(block.evidence.map(x=>x.source_id))]){
    const source=loadedResearch.sources.find(s=>s.id===id);
    if(source)cites.append(sourceLink(source));
  }
  container.append(cites);
}
function renderResearch(data){
  sourceCounter=0;
  $('company-name').textContent=data.company_name;
  $('company-summary').replaceChildren();
  for(const block of data.summary){const part=document.createElement('div');part.className='summary-claim';renderBlock(part,block,'Public-source finding');$('company-summary').append(part);}
  renderBlock($('market-content'),data.market,'Public-source finding');
  const match=data.competitor_match==='direct'&&/\bpotential competitor\b/i.test(data.competitor?.text||'')?'potential':data.competitor_match;
  $('competitor-title').textContent=match==='direct'?'One direct competitor':match==='potential'?'One potential competitor':'Competitor not established';
  renderBlock($('competitor-content'),data.competitor,match==='direct'?'Matched on offering, buyer and geography':'Possible overlap; confirm fit');
  $('swot-content').replaceChildren();
  for(const key of ['strength','weakness','opportunity','threat']){
    const li=document.createElement('li'),label=document.createElement('span'),body=document.createElement('div');
    label.textContent=key[0].toUpperCase()+key.slice(1);body.dataset.testid=`text-${key}`;renderBlock(body,data[key],'Interpretation');
    if(key==='weakness'&&!data[key]){
      body.firstElementChild.textContent='Not established from the reviewed public sources.';
      const question=document.createElement('p');question.textContent='Discovery question: Which constraint, if any, currently limits growth?';body.append(question);
    }
    li.append(label,body);$('swot-content').append(li);
  }
  renderBlock($('strategy-content'),data.strategy,'Proposed strategy');
  $('source-details').replaceChildren();
  const timestamp=document.createElement('p');timestamp.textContent=`Researched ${new Date(data.researched_at).toLocaleString()}. ${data.cached?'Reused recent research. ':''}Only retrieved pages are covered.`;$('source-details').append(timestamp);
  for(const text of data.limitations){const p=document.createElement('p');p.textContent=text;$('source-details').append(p);}
  const seen=new Set();
  const blocks=[data.identity,...data.summary,...['market','competitor','strength','weakness','opportunity','threat','strategy'].map(k=>data[k])].filter(Boolean);
  for(const source of data.sources){
    const div=document.createElement('div');div.className='source-entry';
    const kind=document.createElement('p');kind.className='evidence';kind.textContent=source.kind;
    div.append(sourceLink(source),kind);
    for(const block of blocks)for(const ev of block.evidence){
      const key=ev.source_id+ev.quote;
      if(ev.source_id===source.id&&!seen.has(key)){seen.add(key);const quote=document.createElement('blockquote');quote.textContent=ev.quote;div.append(quote);}
    }
    $('source-details').append(div);
  }
}
function setBusy(value){
  busy=value;
  $('snapshot-form').setAttribute('aria-busy',String(value));
  document.querySelectorAll('#snapshot-form input,#snapshot-form select,#snapshot-form button').forEach(el=>el.disabled=value);
  $('research-status').hidden=!value;
  $('research-status').textContent=value?'Researching public sources and checking supporting passages. This may take a few minutes. Please keep this page open.':'';
  $('retry').disabled=value;
}
async function receiveResearch(response, onPhase,onReceipt){
  if(!response.ok){const data=await response.json();throw Error(data.detail||'Research could not be completed.');}
  if(!response.headers.get('content-type')?.includes('application/x-ndjson'))return response.json();
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result=null;
  function consume(line){
    if(!line.trim())return;
    const event=JSON.parse(line);
    if(event.type==='progress')onPhase(event.message);
    if(event.type==='receipt')onReceipt(event);
    if(event.type==='error')throw Error(event.message);
    if(event.type==='result')result=event.data;
  }
  try{
    while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});
      const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)consume(line);
      if(done){consume(buffer);break;}
    }
  }finally{reader.releaseLock();}
  if(!result)throw Error('The research connection ended before results were ready. Your answers are kept.');
  return result;
}
$('snapshot-form').addEventListener('submit',async e=>{
  e.preventDefault();if(busy||!config||!validate())return;
  const raw=$('website').value.trim();
  const origin=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`).origin;
  const current=++runId;
  renderScore();$('research-output').hidden=true;$('research-failure').hidden=true;$('research-error').textContent='';
  $('booking-note').textContent='';$('intake').hidden=true;$('results').hidden=false;
  $('result-title').focus();window.scrollTo(0,0);
  try{
      setBusy(true);
      $('research-progress').hidden=false;$('research-phase').textContent='Connecting to company research…';
      activeController=new AbortController();
      const response=await fetch('/api/widget/v2/research',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/x-ndjson'},
        body:JSON.stringify({website:origin,answers:Object.fromEntries(questions.map(q=>[q.key,$(q.key).value])),
          capture:{firstName:$('first').value.trim(),lastName:$('last').value.trim(),email:$('email').value.trim(),
            revenueBand:$('revenue').value,noticeVersion:config.leadCapture.notice.version},...(receiptToken?{resumeToken:receiptToken}:{})}),
        signal:AbortSignal.any([activeController.signal,AbortSignal.timeout(255000)])});
      const data=await receiveResearch(response,message=>{if(current===runId)$('research-phase').textContent=message;},
        receipt=>{if(current===runId){receiptToken=receipt.token;expiresAt=receipt.expiresAt;$('receipt-status').textContent=receipt.message;}});
      if(current!==runId)return;
      if(!data.company_name||!Array.isArray(data.summary)||!Array.isArray(data.sources))throw Error('Research returned an incomplete result. No sample content was substituted.');
      loadedResearch=data;loadedOrigin=origin;
    receiptToken=data.token;expiresAt=data.expiresAt;
    renderResearch(loadedResearch);$('research-output').hidden=false;prepareDelivery();
    history.replaceState(null,'',location.pathname+'#snapshot='+receiptToken);
  }catch(err){
    if(current!==runId)return;
    $('research-failure').hidden=false;
    $('research-error').textContent=err.name==='TimeoutError'?'Research timed out. Your readiness feedback and answers are kept. Please retry.':err.message||'Research is unavailable. Your answers are kept.';
  }finally{if(current===runId){$('research-progress').hidden=true;activeController=null;setBusy(false);}}
});
$('retry').addEventListener('click',()=>$('snapshot-form').requestSubmit());
$('edit').addEventListener('click',()=>{runId++;activeController?.abort();activeController=null;receiptToken=null;expiresAt=null;loadedResearch=null;
  setBusy(false);$('receipt-status').textContent='';$('research-progress').hidden=true;$('results').hidden=true;$('intake').hidden=false;
  history.replaceState(null,'',location.pathname);$('website').focus();window.scrollTo(0,0);});
const resultLink=()=>`https://atlas.brexconsulting.com/excavate-v2#snapshot=${receiptToken}`;
function prepareDelivery(){
  $('expiry-note').textContent=`Results access ends ${new Date(expiresAt).toLocaleString()}. Anyone holding this link can view the research and readiness answers until then. Contact details are not included.`;
  $('delivery-email').value=$('email').value.trim();
  $('email-permission').checked=false;$('marketing-permission').checked=false;$('email-status').textContent='';
  $('send-email').disabled=!config?.emailDeliveryReady||!receiptToken;
}
$('copy-link').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(resultLink());$('copy-status').textContent='Results link copied.';}
  catch{$('copy-status').textContent=`Copy this link: ${resultLink()}`;}
});
$('download').addEventListener('click',()=>{
  if(!loadedResearch)return;
  const score=assess(Object.fromEntries(questions.map(q=>[q.key,$(q.key).value])));
  const text=[loadedResearch.company_name,loadedResearch.company_url,
    `Growth readiness: ${score.score===null?'Pending':score.score+'/100'}. ${score.status}`,
    score.next,'Self-reported screening, not a probability of growth or a CMO service tier.',
    ...loadedResearch.summary.map(b=>b.text),
    ...['market','competitor','strength','weakness','opportunity','threat','strategy'].map(k=>`${k.toUpperCase()}: ${loadedResearch[k]?.text||'Not established from reviewed sources.'}`),
    'SOURCES',...loadedResearch.sources.map(s=>`${s.title}: ${s.url}`),...loadedResearch.limitations,
    `Results: ${resultLink()}`,`Access ends: ${expiresAt}`].join('\n\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='brex-growth-snapshot.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('email-form').addEventListener('submit',async e=>{
  e.preventDefault();if(emailBusy||!config?.emailDeliveryReady||!receiptToken||!$('email-form').reportValidity())return;
  emailBusy=true;$('send-email').disabled=true;$('email-status').textContent='Recording your requested email and permission…';
  try{
    const r=await fetch('/api/widget/snapshot/lead',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:receiptToken,email:$('delivery-email').value.trim(),snapshotEmailConsent:$('email-permission').checked,
        snapshotEmailConsentVersion:config.snapshotEmailConsent.version,marketingConsent:$('marketing-permission').checked,
        marketingConsentVersion:config.marketingConsent.version})});
    const data=await r.json();if(!r.ok)throw Error(data.error||'Email request could not be confirmed.');
    $('email-status').textContent=data.message;
  }catch(err){$('email-status').textContent=err.message+' Keep your results link and contact Kenny before submitting again.';}
  finally{emailBusy=false;/* An ambiguous request must not encourage duplicate sends. */}
});
async function init(){
  try{
    const r=await fetch('/api/widget/snapshot/config');if(!r.ok)throw Error('Settings unavailable');
    config=await r.json();if(!config.leadCapture?.required||!config.leadCapture?.notice?.version)throw Error('Required inquiry settings unavailable');
    $('capture-notice').textContent=config.leadCapture.notice.text;
    $('email-permission-text').textContent=config.snapshotEmailConsent?.text||'Email permission settings unavailable.';
    $('marketing-permission-text').textContent=config.marketingConsent?.text||'Marketing settings unavailable.';
    $('email-availability').textContent=config.emailDeliveryReady?'Email delivery is subject to eligibility and existing preferences. Promotional permission is optional and separate.':'Email delivery is temporarily unavailable. You can still save your results link or text copy.';
    setBusy(false);
  }catch{$('form-error').textContent='Inquiry settings are unavailable. Please refresh before submitting.';$('submit').disabled=true;}
  const token=new URLSearchParams(location.hash.slice(1)).get('snapshot');
  if(token){
    try{
      const r=await fetch('/api/widget/snapshot/view',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
      const data=await r.json();if(!r.ok)throw Error(data.error||'Snapshot unavailable.');
      if(data.snapshot?.kind!=='company-growth-v2'){location.replace('/excavate-v1#snapshot='+encodeURIComponent(token));return;}
      if(data.snapshot.researchStatus!=='ready'||!data.snapshot.research)throw Error('This company research is not available yet. Run a fresh snapshot or contact Kenny for help.');
      receiptToken=token;expiresAt=data.expiresAt;loadedResearch=data.snapshot.research;
      $('website').value=data.snapshot.companyUrl;for(const q of questions)$(q.key).value=data.snapshot.growth.answers[q.key];
      renderScore();renderResearch(loadedResearch);$('intake').hidden=true;$('results').hidden=false;$('research-output').hidden=false;prepareDelivery();
    }catch(err){$('form-error').textContent=err.message;}
  }
}
const parents=['https://brexconsulting.com','https://www.brexconsulting.com','https://atlas.brexconsulting.com'];
let heightFrame=0;
function height(){cancelAnimationFrame(heightFrame);heightFrame=requestAnimationFrame(()=>{
  const measured=Math.ceil(document.querySelector('main').getBoundingClientRect().height);
  for(const origin of parents)for(const type of ['atlas-widget-height','brex-atlas-height'])
    if(window.parent!==window)window.parent.postMessage({type,height:measured},origin);
});}
new ResizeObserver(height).observe(document.querySelector('main'));
window.addEventListener('message',event=>{if(event.source===window.parent&&parents.includes(event.origin)&&
  ['brex-atlas-request-height','atlas-widget-request-height'].includes(event.data?.type))height();});
window.addEventListener('load',height);
init();

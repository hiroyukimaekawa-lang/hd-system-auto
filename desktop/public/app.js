const $=selector=>document.querySelector(selector), $$=selector=>[...document.querySelectorAll(selector)];
let config={phases:[],objections:[]}, catalog={departments:[],scripts:[],applicationGuide:null}, selectedDepartment='hd', selectedScript='hd-new-ap-20260725', currentSession=null, currentPhase=null, currentSuggestion=null, activePreparation=null, activeDeal=null, editingDealId=null, deals=[], renamingScriptId=null, saveTimer=null, applicationItem=1;
let currentSection=null, interviewData={}, phase10State={}, interviewSaveTimer=null;
let quickObjectionSuggestion=null, quickObjectionOffset=0, quickObjectionBusy=false, quickObjectionComposing=false;
let scriptSelectionTouched=false;
const ACTIVE_MEETING_KEY='hdActiveMeetingId';
const storage={
  get(key){try{return localStorage.getItem(key)||''}catch{return ''}},
  set(key,value){try{if(value)localStorage.setItem(key,value);else localStorage.removeItem(key)}catch{}}
};
// スクリプト名・商材名など、テンプレート文字列経由でinnerHTMLへ入れる値は必ずエスケープする
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
// 店舗名・オーナー名・メモなど利用者入力はすべてDOM APIで組み立てる（innerHTMLを使わない）
function el(tag,props={},children=[]){
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(props)){
    if(key==='class')node.className=value;
    else if(key==='text')node.textContent=value;
    else if(key==='dataset')Object.assign(node.dataset,value);
    else if(value!==undefined&&value!==null&&value!==false)node.setAttribute(key,value===true?'':value);
  }
  for(const child of [].concat(children))if(child)node.append(child);
  return node;
}
const api=async(url,options={})=>{
  const response=await fetch(url,{headers:{'content-type':'application/json'},...options});
  const contentType=response.headers.get('content-type')||'';
  if(!contentType.includes('application/json')){
    if(response.status===404&&url.startsWith('/api/')) throw new Error('アプリの再起動が必要です。HD統合システムを一度終了して、もう一度起動してください。');
    throw new Error(`サーバーから正しい応答を受け取れませんでした（${response.status}）`);
  }
  const data=await response.json();
  if(!response.ok)throw new Error(data.text||'処理に失敗しました');
  return data;
};
let toastTimer;
const toast=text=>{const el=$('#toast');el.textContent=text;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),text.length>35?6500:2400)};
FsSidebar.render($('#fs-sidebar'));
FsSidebar.mark('deals');
// 事前情報は固定せず、スクリプトを読み進めると画面外へ送ってスクリプト領域を広げる
function bindPreinfoAutoHide(){
  const panel=$('.script-panel');
  if(!panel)return;
  panel.addEventListener('scroll',()=>{
    document.body.classList.toggle('preinfo-hidden',panel.scrollTop>40);
  },{passive:true});
}
// 商談画面だけグローバルヘッダーを隠し、縦方向をスクリプトへ回す
function show(view){$$('.view').forEach(node=>node.classList.toggle('active',node.id===`view-${view}`));document.body.classList.toggle('fs-meeting-active',view==='assist');FsSidebar.mark(view);$('#user-menu').open=false;window.scrollTo(0,0)}
document.addEventListener('click',event=>{const view=event.target.closest('[data-view]')?.dataset.view;if(view)show(view)});
const phaseLabelOf=id=>config.phases.find(phase=>phase.id===id)?.name||'';
function phaseById(id){return config.phases.find(phase=>phase.id===id)}
async function loadScriptPhases(id){
  const data=await api(`/api/sales/config?talkScriptId=${encodeURIComponent(id||'hd-new-ap-20260725')}`);
  config={...config,phases:data.phases,objections:data.objections||config.objections};
  return config.phases;
}
function parseIsTemplate(text){
  const source=String(text||'').replaceAll('\r',''),lines=source.split('\n').map(line=>line.trim()).filter(line=>line&&!/^-{3,}$/.test(line));
  const labels=['店舗名','住所','オーナー','店舗番号','携帯','対象商材','トーク詳細','オーナーの反応','アポ獲得に至った経緯','懸念点','備考'];
  const values={};let current='';
  for(const line of lines){
    const match=line.match(/^([^:：]+)[:：]\s*(.*)$/),label=match?.[1]?.trim();
    if(match&&labels.includes(label)){current=label;values[label]=[values[label],match[2].trim()].filter(Boolean).join('\n');continue}
    if(current)values[current]=[values[current],line].filter(Boolean).join('\n');
  }
  const reaction=source.match(/オーナーの反応\s*[:：]\s*([^\n]+)/)?.[1]?.trim()||values['オーナーの反応']||'';
  const appointment=source.match(/アポ獲得に至った経緯\s*[:：]\s*([^\n]+)/)?.[1]?.trim()||values['アポ獲得に至った経緯']||'';
  const questions=lines.filter(line=>/[？?]/.test(line)).join('、');
  let temperature='不明：IS段階では判断できない';
  if(/作ってほしい|ぜひ|是非|興味あり|詳しく/.test(reaction))temperature='高い：作りたい・詳しく聞きたい';
  else if(/半信半疑|条件|無料なら|本当|疑/.test(`${reaction} ${questions}`))temperature='中：無料なら興味あり・条件次第';
  else if(/興味なし|不要|断り|いらない/.test(reaction))temperature='低い：話だけ聞く・必要性は未認識';
  const issueParts=[];
  if(questions)issueParts.push(questions);
  if(values['懸念点']&&!/^(なし|特になし)$/.test(values['懸念点']))issueParts.push(values['懸念点']);
  const issueText=issueParts.join('\n')||'IS段階で明確な課題は未確認';
  const hooks=[];
  if(/無料|費用|本当/.test(source))hooks.push('無料になる仕組みと、後から発生する費用の有無を明確に説明する');
  if(/モデル店舗/.test(source))hooks.push('モデル店舗として制作する意味と制作品質を具体的に見せる');
  if(/エネパル|電気/.test(source))hooks.push('HPへの仮合意を取ってから、エネパルが無料制作条件であることを説明する');
  if(/カード/.test(source))hooks.push('カードはHP・エネパルとは別契約で、任意であることを明確にする');
  const isNotes=[values['備考'],values['懸念点']&&`懸念：${values['懸念点']}`,reaction&&`オーナーの反応：${reaction}`].filter(Boolean).join('\n');
  return {customerName:values['店舗名']||'',address:values['住所']||'',ownerName:(values['オーナー']||'').replace(/(?:\s*様)+\s*$/,'').trim(),storePhone:values['店舗番号']||'',mobile:values['携帯']||'',targetProducts:values['対象商材']||'',talkDetails:values['トーク詳細']||'',reaction,appointment,appointmentBackground:appointment,isNotes,concerns:values['懸念点']||'',otherNotes:values['備考']||'',temperature,temperatureReason:reaction||questions||'IS情報から自動判定',issues:issueText,hookPoints:hooks.join('\n')||'商談冒頭でHPへの印象と今後の展望を確認する',handoff:source};
}
const PREP_FILLABLE=['customerName','address','ownerName','storePhone','mobile','targetProducts','talkDetails','concerns','otherNotes','temperature','temperatureReason','issues','hookPoints','isNotes','appointmentBackground','handoff'];
function applyIsTemplate(text){
  const form=$('#preparation-form'),data=parseIsTemplate(text);
  // 解析結果は空欄だけを埋め、担当者が直した内容は上書きしない
  for(const name of PREP_FILLABLE)if(form.elements[name]&&(!form.elements[name].value.trim()||name==='handoff'))form.elements[name].value=data[name]||'';
  if(form.elements.appointmentPattern)form.elements.appointmentPattern.value=/台本通り/.test(data.appointment)?'HP無料制作の案内として取得':/詳細|ほとんど/.test(data.appointment)?'詳細をほとんど伝えていない':'';
  $('#analysis-store').textContent=data.customerName||'未取得';$('#analysis-owner').textContent=data.ownerName?`${data.ownerName}様`:'未取得';$('#analysis-products').textContent=data.targetProducts||'未取得';$('#analysis-temperature').textContent=data.temperature;$('#analysis-temperature-reason').textContent=data.temperatureReason;$('#analysis-issues').textContent=data.issues;$('#analysis-hooks').textContent=data.hookPoints;$('#analysis-status').textContent='解析済み';$('#handoff-analysis').hidden=false;
  return data;
}
function formatScriptText(text){
  const blocks=String(text||'').split(/\n\s*\n/).map(value=>value.trim()).filter(Boolean),paragraphs=[];let current='';
  const special=value=>/^【.+】$/.test(value)||/^[①②③④⑤⑥⑦⑧]\s/.test(value)||/^https?:\/\//.test(value)||/^(回答後|追加後|受信確認後|最終確認後|続けて)[：:]?$/.test(value);
  const flush=()=>{if(current){paragraphs.push(current);current=''}};
  for(const block of blocks){
    if(special(block)){flush();paragraphs.push(block);continue}
    if(!current){current=block;continue}
    if(current.length+block.length>190||/[？?]$/.test(current)||/^「/.test(block)){flush();current=block;continue}
    current+=block;
  }
  flush();return paragraphs.join('\n\n');
}
const statusLabel=status=>({published:'公開中',preparing:'準備中',unregistered:'未登録',draft:'下書き',review:'レビュー待ち',approved:'承認済み',stopped:'停止中',retired:'廃止',archived:'過去版'}[status]||status);
function renderCatalog(){
  $('#admin-department-filter').innerHTML='<option value="hd">HD事業部</option>';$('#admin-department-filter').value='hd';
  renderAdminScripts();
}
function scriptCard(item,admin=false){
  const department=catalog.departments.find(value=>value.id===item.department_id);
  const name=escapeHtml(item.name),products=escapeHtml(item.products.join('＋')||'商材未登録'),customerType=escapeHtml(item.customer_type||'—'),departmentName=escapeHtml(department?.name||item.department_id);
  const publishButton=admin&&item.status==='draft'?`<button class="primary" data-script-publish="${item.id}">公開する</button>`:'';
  return `<article class="script-card"><header><span>${departmentName}</span><em class="status ${item.status}">${statusLabel(item.status)}</em></header><h2>${name}</h2><p>${products}</p><dl><div><dt>対象顧客</dt><dd>${customerType}</dd></div><div><dt>バージョン</dt><dd>${escapeHtml(item.version||'—')}</dd></div><div><dt>最終更新日</dt><dd>${escapeHtml(item.updated_at?.slice(0,10)||'—')}</dd></div><div><dt>フェーズ数</dt><dd>${item.phase_count||0}</dd></div><div><dt>使用回数</dt><dd>${item.use_count||0}</dd></div></dl><footer>${admin?`<button class="secondary" data-script-preview="${item.id}">確認</button><button class="secondary" data-script-rename="${item.id}">タイトル編集</button><button class="secondary" data-script-flow="${item.id}">フロー編集</button><button class="primary" data-script-edit="${item.id}" ${item.status==='unregistered'?'disabled':''}>内容編集</button>${publishButton}`:`<button class="secondary" data-script-preview="${item.id}">内容確認</button><button class="primary" data-script-start="${item.id}" ${item.status!=='published'?'disabled':''}>${item.status==='published'?'商談を開始':'利用できません'}</button>`}</footer></article>`;
}
async function publishScript(id){
  try{
    const data=await api(`/api/sales/talk-scripts/${encodeURIComponent(id)}/publish`,{method:'POST',body:JSON.stringify({actor:'FS'})});
    catalog=await api('/api/sales/catalog');
    renderAdminScripts();renderHomeTemplates();renderPreparationScriptSelector();
    toast(`${data.script.name}を公開しました`);
  }catch(error){toast(error.message)}
}
function bindScriptButtons(){
  $$('[data-script-start]').forEach(button=>button.addEventListener('click',()=>selectTalkScript(button.dataset.scriptStart)));
  $$('[data-script-preview]').forEach(button=>button.addEventListener('click',()=>openScriptPreview(button.dataset.scriptPreview)));
  $$('[data-script-rename]').forEach(button=>button.addEventListener('click',()=>openRenameScript(button.dataset.scriptRename)));
  $$('[data-script-flow]').forEach(button=>button.addEventListener('click',()=>openScriptFlow(catalog.scripts.find(item=>item.id===button.dataset.scriptFlow))));
  $$('[data-script-publish]').forEach(button=>button.addEventListener('click',()=>publishScript(button.dataset.scriptPublish)));
  $$('[data-script-edit]').forEach(button=>button.addEventListener('click',async()=>{const script=catalog.scripts.find(item=>item.id===button.dataset.scriptEdit);await loadScriptPhases(button.dataset.scriptEdit);renderPhases();$('#phase-editor-title').textContent=`${script?.name||'トークスクリプト'}・フェーズ編集`;$('#phase-editor').hidden=false;$('#phase-editor').scrollIntoView({behavior:'smooth'});editPhase(config.phases[0]?.id)}));
}
function openRenameScript(id){
  const script=catalog.scripts.find(item=>item.id===id);if(!script)return;
  renamingScriptId=id;$('#rename-script-name').value=script.name;$('#rename-script-dialog').showModal();$('#rename-script-name').focus();
}
async function openScriptPreview(id,phaseId){
  const item=catalog.scripts.find(value=>value.id===id),department=catalog.departments.find(value=>value.id===item?.department_id);
  if(!item)return;
  await loadScriptPhases(id);
  $('#preview-department').textContent=department?.name||'HD事業部';$('#preview-script-name').textContent=item.name;$('#preview-script-meta').textContent=`${item.products.join('＋')||'商材未登録'}｜${item.version||'バージョン未登録'}｜${statusLabel(item.status)}`;
  const available=item.phase_count>0;
  $('#preview-empty').hidden=available;$('#preview-content').hidden=!available;
  if(!available)$('#preview-empty').innerHTML=`<b>${statusLabel(item.status)}</b><p>このトークスクリプトには、まだ閲覧できるフェーズが登録されていません。</p>`;
  if(available){$('#preview-phase-list').innerHTML=config.phases.map(phase=>`<button data-preview-phase="${phase.id}"><span>${phase.group_name}</span>${phase.name}</button>`).join('');$$('[data-preview-phase]').forEach(button=>button.addEventListener('click',()=>renderPreviewPhase(button.dataset.previewPhase)));renderPreviewPhase(phaseId&&phaseById(phaseId)?phaseId:config.phases[0].id)}
  $('#script-preview-dialog').showModal();
}
function renderPreviewPhase(id){
  const phase=phaseById(id);if(!phase)return;
  $$('[data-preview-phase]').forEach(button=>button.classList.toggle('active',button.dataset.previewPhase===id));
  $('#preview-phase-number').textContent=`PHASE ${phase.group_name}`;$('#preview-phase-name').textContent=phase.name;$('#preview-goal').textContent=phase.goal;$('#preview-script-body').textContent=formatScriptText(phase.base_script);$('#preview-checks').innerHTML=phase.required_questions.map(item=>`<li>${item}</li>`).join('');$('#preview-transition').textContent=phase.transition_conditions;$('#preview-prohibited').innerHTML=phase.prohibited_phrases.map(item=>`<span>${item}</span>`).join('');$('#preview-prohibited-box').hidden=!phase.prohibited_phrases.length;
  const guide=catalog.applicationGuide,showGuide=/申込書/.test(phase.name);$('#preview-application-guide').hidden=!showGuide;
  if(showGuide&&guide){const variant=guide.variants.enepal;$('#preview-application-guide').innerHTML=`<span class="eyebrow">APPLICATION GUIDE</span><h2>申込書読み合わせガイド</h2><p>商談画面では、申込書の種類を選び、1項目ずつ大きく表示できます。</p>${guide.sections.map(item=>`<details><summary><b>第${item.number}項</b> ${item.title}</summary><p>${applicationText(item.talk,variant)}</p></details>`).join('')}`}
}
$('#close-preview').addEventListener('click',()=>$('#script-preview-dialog').close());
$('#close-rename-script').addEventListener('click',()=>$('#rename-script-dialog').close());
$('#rename-script-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!renamingScriptId)return;
  try{
    const data=await api(`/api/sales/talk-scripts/${renamingScriptId}`,{method:'PUT',body:JSON.stringify({name:$('#rename-script-name').value,actor:'管理者'})});
    catalog.scripts=catalog.scripts.map(item=>item.id===renamingScriptId?data.script:item);
    renderAdminScripts();renderHomeTemplates();renderPreparationScriptSelector();
    $('#rename-script-dialog').close();toast('トークスクリプト名を保存しました');
  }catch(error){toast(error.message)}
});
// ===== トークスクリプトを商談フローごと新規作成・編集する =====
let flowPhases=[],flowEditingId=null,flowSourceText=null;
const flowLine=value=>String(value||'').split('\n').map(v=>v.trim()).filter(Boolean);
function flowPhaseRow(phase,index){
  const move=(from,to)=>{if(to<0||to>=flowPhases.length)return;readFlowPhases();const [item]=flowPhases.splice(from,1);flowPhases.splice(to,0,item);renderFlowPhases()};
  const up=el('button',{type:'button',text:'↑'});up.addEventListener('click',()=>move(index,index-1));
  const down=el('button',{type:'button',text:'↓'});down.addEventListener('click',()=>move(index,index+1));
  const remove=el('button',{type:'button',class:'danger',text:'削除'});
  remove.addEventListener('click',()=>{readFlowPhases();flowPhases.splice(index,1);renderFlowPhases()});
  const merge=el('button',{type:'button',text:'↑と統合'});
  merge.title='本文を1つ前のフェーズへ統合し、このフェーズを削除します（自動生成後の微修正用）';
  merge.hidden=index===0;
  merge.addEventListener('click',()=>{
    readFlowPhases();
    if(index<=0)return;
    const current=flowPhases[index];
    flowPhases[index-1]={...flowPhases[index-1],script:[flowPhases[index-1].script,current.script].filter(Boolean).join('\n\n')};
    flowPhases.splice(index,1);
    renderFlowPhases();
  });
  const field=(label,key,{tag='input',rows,placeholder,wide,value}={})=>{
    const control=tag==='textarea'?el('textarea',{rows:String(rows||3),placeholder:placeholder||''}):el('input',{placeholder:placeholder||''});
    control.value=value??'';control.dataset.flowField=key;
    return el('label',{class:wide?'wide':''},[document.createTextNode(label),control]);
  };
  const head=el('div',{class:'flow-phase-head'},[
    el('span',{class:'flow-index',text:`フェーズ ${index+1}`}),
    el('div',{class:'flow-move'},[up,down,merge,remove])
  ]);
  const grid=el('div',{class:'flow-grid'},[
    field('記号','group',{placeholder:'①',value:phase.group}),
    field('フェーズ名','name',{placeholder:'例：前提のすり合わせと本日のアジェンダ',value:phase.name}),
    field('このフェーズの目的','goal',{placeholder:'例：認識をそろえ決裁権を確認する',value:phase.goal}),
    field('読み上げスクリプト','script',{tag:'textarea',rows:8,wide:true,placeholder:'商談で読み上げる本文',value:phase.script}),
    field('確認事項（1行1項目）','questions',{tag:'textarea',rows:4,placeholder:'認識のズレがない\n決裁権を確認した',value:(phase.questions||[]).join('\n')}),
    field('次へ進む条件','transition',{tag:'textarea',rows:4,placeholder:'例：認識が合えば②へ進む',value:phase.transition}),
    field('禁止表現（1行1項目）','prohibited',{tag:'textarea',rows:3,wide:true,placeholder:'絶対に安くなる',value:(phase.prohibited||[]).join('\n')})
  ]);
  return el('section',{class:'flow-phase'},[head,grid]);
}
function renderFlowPhases(){
  const list=$('#flow-phase-list');list.textContent='';
  if(!flowPhases.length)list.append(el('p',{class:'muted small',text:'「＋ フェーズを追加」または「現在の商談フローを読み込む」から始めてください。'}));
  flowPhases.forEach((phase,index)=>list.append(flowPhaseRow(phase,index)));
  $('#flow-count').textContent=`${flowPhases.length}フェーズ`;
}
// 画面の入力値を配列へ取り込む（並べ替え・保存の前に必ず呼ぶ）
function readFlowPhases(){
  flowPhases=[...$('#flow-phase-list').querySelectorAll('.flow-phase')].map((row,index)=>{
    const value=key=>row.querySelector(`[data-flow-field="${key}"]`)?.value||'';
    return {
      id:flowPhases[index]?.id,
      group:value('group').trim()||`${index+1}`,
      name:value('name').trim(),
      goal:value('goal').trim(),
      script:value('script'),
      questions:flowLine(value('questions')),
      transition:value('transition').trim(),
      prohibited:flowLine(value('prohibited'))
    };
  });
  return flowPhases;
}
function openScriptFlow(script,{importMode=false}={}){
  const form=$('#script-flow-form');form.reset();
  flowEditingId=script?.id||null;flowSourceText=null;
  $('#script-flow-title').textContent=script?`${script.name}のフローを編集`:'トークスクリプトを新規作成';
  $('#script-flow-message').textContent='';
  $('#flow-import-textarea').value='';$('#flow-import-message').textContent='';
  $('#flow-import-details').open=importMode&&!script;$('#flow-import-details').hidden=Boolean(script);
  // 公開済みを直接編集する既存フローは従来どおり「保存」のみ。新規作成は下書き/公開を選べる
  $('#script-flow-save-draft').hidden=Boolean(script);
  $('#script-flow-submit').textContent=script?'保存':'公開する';
  if(script){
    form.elements.name.value=script.name||'';
    form.elements.products.value=(script.products||[]).join('、');
    form.elements.customerType.value=script.customer_type||'';
    form.elements.version.value=script.version||'';
  }else{
    form.elements.customerType.value='店舗オーナー・小規模事業者';
    form.elements.version.value=new Date().toLocaleDateString('ja-JP');
  }
  flowPhases=[];renderFlowPhases();
  $('#script-flow-dialog').showModal();
  if(script)loadFlowFrom(script.id);
  if(importMode&&!script)requestAnimationFrame(()=>$('#flow-import-textarea').focus());
}
async function loadFlowFrom(talkScriptId){
  try{
    const data=await api(`/api/sales/config?talkScriptId=${encodeURIComponent(talkScriptId)}`);
    flowPhases=data.phases.map(phase=>({group:phase.group_name,name:phase.name,goal:phase.goal,script:phase.base_script,questions:phase.required_questions||[],transition:phase.transition_conditions,prohibited:phase.prohibited_phrases||[]}));
    renderFlowPhases();
  }catch(error){$('#script-flow-message').textContent=error.message}
}
$('#flow-add-phase').addEventListener('click',()=>{readFlowPhases();flowPhases.push({group:`${flowPhases.length+1}`,name:'',goal:'',script:'',questions:[],transition:'',prohibited:[]});renderFlowPhases()});
$('#flow-load-default').addEventListener('click',()=>loadFlowFrom($('#preparation-script-select').value||selectedScript));
$('#close-script-flow').addEventListener('click',()=>$('#script-flow-dialog').close());
$('#cancel-script-flow').addEventListener('click',()=>$('#script-flow-dialog').close());
// 長文貼り付け→自動フロー化：見出しルールパーサー（LLM不要）でフェーズ化し、人が微修正できる状態にする
$('#flow-import-parse').addEventListener('click',async()=>{
  const text=$('#flow-import-textarea').value;
  if(!text.trim())return void($('#flow-import-message').textContent='原稿を貼り付けてください');
  const button=$('#flow-import-parse');button.disabled=true;$('#flow-import-message').textContent='解析しています…';
  try{
    const data=await api('/api/sales/talk-scripts/parse',{method:'POST',body:JSON.stringify({text})});
    flowSourceText=text;
    flowPhases=data.phases.map(phase=>({group:phase.group,name:phase.title,goal:'',script:phase.script,questions:[],transition:'',prohibited:[]}));
    renderFlowPhases();
    const form=$('#script-flow-form');
    if(!form.elements.name.value.trim()&&data.title)form.elements.name.value=data.title;
    if(!form.elements.version.value.trim()&&data.version)form.elements.version.value=data.version;
    const linkNote=data.referenceLinks.length?`参考リンクを${data.referenceLinks.length}件検出しました（資料ライブラリへは自動登録しません）。`:'';
    $('#flow-import-message').textContent=`${data.phases.length}フェーズを作成しました。${linkNote}内容を確認・微修正してください。`;
    $('#flow-import-details').open=false;
  }catch(error){$('#flow-import-message').textContent=error.message}
  finally{button.disabled=false}
});
$('#script-flow-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const submitterId=event.submitter?.id||'script-flow-submit';
  const form=event.currentTarget,meta=Object.fromEntries(new FormData(form));
  const phases=readFlowPhases();
  if(!phases.length)return void($('#script-flow-message').textContent='フェーズを1つ以上追加してください');
  const missing=phases.findIndex(phase=>!phase.name);
  if(missing>=0)return void($('#script-flow-message').textContent=`フェーズ${missing+1}のフェーズ名を入力してください`);
  $('#script-flow-message').textContent='保存しています…';
  try{
    let scriptId=flowEditingId;
    if(scriptId){
      await api(`/api/sales/talk-scripts/${encodeURIComponent(scriptId)}`,{method:'PUT',body:JSON.stringify({name:meta.name,actor:'管理者'})});
    }else{
      const status=submitterId==='script-flow-save-draft'?'draft':'published';
      const body={...meta,actor:'FS',status,...(flowSourceText?{sourceType:'rule_import',sourceText:flowSourceText}:{})};
      scriptId=(await api('/api/sales/talk-scripts',{method:'POST',body:JSON.stringify(body)})).script.id;
    }
    const data=await api(`/api/sales/talk-scripts/${encodeURIComponent(scriptId)}/phases`,{method:'PUT',body:JSON.stringify({phases,version:meta.version,actor:'FS'})});
    catalog=await api('/api/sales/catalog');
    renderAdminScripts();renderHomeTemplates();renderPreparationScriptSelector();
    $('#script-flow-dialog').close();
    const statusNote=!flowEditingId&&submitterId==='script-flow-save-draft'?'（下書き）':'';
    toast(`${data.script.name}を${flowEditingId?'更新':'作成'}しました${statusNote}（${phases.length}フェーズ）`);
  }catch(error){$('#script-flow-message').textContent=error.message}
});
$('#open-create-script').addEventListener('click',()=>openScriptFlow(null));
$('#new-script-button').addEventListener('click',()=>openScriptFlow(null));
$('#import-script-button').addEventListener('click',()=>openScriptFlow(null,{importMode:true}));
$('#close-create-script').addEventListener('click',()=>$('#create-script-dialog').close());
$('#create-script-form').addEventListener('submit',async event=>{
  event.preventDefault();
  try{
    const body=Object.fromEntries(new FormData(event.currentTarget));body.actor='管理者';
    const data=await api('/api/sales/talk-scripts',{method:'POST',body:JSON.stringify(body)});
    catalog.scripts.push(data.script);selectedScript=data.script.id;
    renderAdminScripts();renderHomeTemplates();renderPreparationScriptSelector();
    $('#create-script-dialog').close();toast('トークスクリプトを追加しました');
  }catch(error){toast(error.message)}
});
async function selectTalkScript(id){
  const script=catalog.scripts.find(item=>item.id===id);if(!script||script.status!=='published')return;
  await loadScriptPhases(id);renderPhases();
  scriptSelectionTouched=true;selectedScript=id;selectedDepartment=script.department_id;
  const form=$('#preparation-form');form.elements.departmentId.value=selectedDepartment;form.elements.talkScriptId.value=id;
  $('#preparation-script-select').value=id;renderPreparationScriptSummary();show('preparation');
}
function renderAdminScripts(){
  const department=$('#admin-department-filter').value,status=$('#admin-status-filter').value;
  $('#admin-script-cards').innerHTML=catalog.scripts.filter(item=>(!department||item.department_id===department)&&(!status||item.status===status)).map(item=>scriptCard(item,true)).join('')||'<p class="muted">該当するスクリプトはありません。</p>';bindScriptButtons();
}
function renderHomeTemplates(){
  const published=catalog.scripts.filter(item=>item.department_id==='hd'&&item.status==='published');
  $('#published-script-count').textContent=`${published.length}件`;$('#published-script-summary').textContent=published.map(item=>item.name).join('・');
  $('#home-template-list').innerHTML=published.map(item=>`<article><div class="template-icon">▤</div><div><span>HD事業部・正式テンプレート</span><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.products.join('＋'))}｜${escapeHtml(item.customer_type)}</p><small>ISアポ基準：HP無料制作の案内として取得</small></div><dl><div><dt>バージョン</dt><dd>${escapeHtml(item.version)}</dd></div><div><dt>フェーズ</dt><dd>${item.phase_count}</dd></div><div><dt>状態</dt><dd>${statusLabel(item.status)}</dd></div></dl><div class="template-actions"><button class="secondary" data-script-preview="${item.id}">内容を見る</button><button class="primary" data-script-start="${item.id}">このトークで準備</button></div></article>`).join('');
  bindScriptButtons();
}
function renderPreparationScriptSelector(){
  const showArchived=$('#preparation-show-archived')?.checked;
  const scripts=catalog.scripts.filter(item=>item.department_id==='hd'&&(item.status==='published'||(showArchived&&item.status==='archived')));
  const select=$('#preparation-script-select');
  select.innerHTML=scripts.map(item=>`<option value="${item.id}">${escapeHtml(item.name)}｜${escapeHtml(item.version||'バージョン未登録')}${item.status==='archived'?'（過去版）':''}</option>`).join('');
  // 初回表示（利用者がまだ選び直していない）は既定スクリプト（2026/08/06）を優先する
  if(!scriptSelectionTouched){
    const def=scripts.find(item=>item.default_for_preparation);
    if(def)selectedScript=def.id;
  }
  if(scripts.some(item=>item.id===selectedScript))select.value=selectedScript;
  else if(scripts[0]){selectedScript=scripts[0].id;select.value=selectedScript}
  renderPreparationScriptSummary();
}
async function renderPreparationScriptSummary(){
  const id=$('#preparation-script-select').value,script=catalog.scripts.find(item=>item.id===id);
  if(!script){$('#preparation-script-meta').textContent='利用できるスクリプトがありません';$('#preparation-script-phases').innerHTML='';return}
  await loadScriptPhases(id);
  selectedScript=id;$('#preparation-form').elements.talkScriptId.value=id;
  $('#preparation-script-meta').textContent=`${config.phases.length}フェーズ ／ ${script.products.join('＋')||'商材未登録'} ／ ${statusLabel(script.status)}`;
  $('#preparation-script-phases').innerHTML=config.phases.map(phase=>`<button type="button" data-preparation-phase="${phase.id}"><span>${phase.group_name}</span>${phase.name}</button>`).join('');
  $$('[data-preparation-phase]').forEach(button=>button.addEventListener('click',()=>openScriptPreview(id,button.dataset.preparationPhase)));
}
const dealDate=(value,fallback='—')=>{
  const raw=String(value||'').trim();if(!raw)return fallback;
  const date=new Date(raw.length<=16&&raw.includes('T')?`${raw}:00`:raw);
  return Number.isNaN(date.getTime())?raw:date.toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
};
const dealField=(label,value)=>el('div',{class:'deal-field'},[el('small',{text:label}),el('b',{text:String(value||'—').trim()||'—'})]);
function dealActions(deal){
  const buttons=[];
  const add=(label,className,handler)=>{const button=el('button',{class:className,type:'button',text:label});button.addEventListener('click',handler);buttons.push(button)};
  if(deal.meetingId&&!deal.finishedAt)add('商談再開','primary',()=>openDeal(deal));
  else if(!deal.finishedAt)add('商談開始','primary',()=>openDeal(deal));
  add('案件情報を見る','secondary',()=>showDealDetail(deal.dealId));
  if(deal.preparationId)add('案件情報を編集','secondary',()=>editDeal(deal.dealId));
  if(deal.finishedAt)add('結果と振り返りを見る','secondary',()=>{show('results');showResultDetail(deal.dealId)});
  add('削除','danger',()=>confirmDeleteDeal(deal));
  return el('div',{class:'deal-actions-row'},buttons);
}
let pendingDeleteDeal=null;
function confirmDeleteDeal(deal){
  // 一覧が古いままでも、開いている商談の案件は削除させない
  const openDealId=currentSession?.deal_id||'';
  if(currentSession&&((deal.meetingId&&deal.meetingId===currentSession.id)||(openDealId&&deal.dealId===openDealId)))return toast('進行中の商談です。中断または終了してから削除してください');
  pendingDeleteDeal=deal;
  $('#delete-deal-target').textContent=[deal.storeName||'店舗名未入力',deal.ownerName&&`${deal.ownerName}様`].filter(Boolean).join('／');
  $('#delete-deal-detail').textContent=`${deal.meetingId?`この案件の商談記録（メモ・言質・アウト履歴）もあわせて削除されます。ステータス：${deal.status}`:`まだ商談を開始していない案件です。ステータス：${deal.status}`}\nObsidianへ書き出したノートがある場合は、そのノートも削除されます。`;
  $('#delete-deal-dialog').showModal();
}
// method="dialog" のフォーム送信でダイアログは閉じるため、submitで受ける
$('#delete-deal-form').addEventListener('submit',async event=>{
  const deal=pendingDeleteDeal;pendingDeleteDeal=null;
  if(event.submitter?.value!=='delete'||!deal)return;
  try{
    const data=await api(`/api/fs/deals/${encodeURIComponent(deal.dealId||deal.meetingId||deal.preparationId)}`,{method:'DELETE'});
    await Promise.all([loadDeals(),renderResults()]);
    const name=data.removed.storeName||'店舗名未入力';
    toast(data.removed.obsidianError?`「${name}」を削除しました。Obsidianのノートは削除できませんでした（${data.removed.obsidianError}）`
      :data.removed.obsidianRemoved?`「${name}」を削除しました（Obsidianノート${data.removed.obsidianRemoved}件も削除）`
      :`「${name}」を削除しました`);
  }catch(error){toast(error.message)}
});
function dealCard(deal){
  const head=el('div',{class:'deal-card-head'},[
    el('span',{class:`deal-status status-${deal.status}`,text:deal.status}),
    el('h3',{text:deal.storeName||'店舗名未入力'}),
    el('p',{text:[deal.ownerName&&`${deal.ownerName}様`,deal.products].filter(Boolean).join('｜')||'オーナー名未入力'})
  ]);
  const fields=el('div',{class:'deal-fields'},[
    dealField('商談日時',dealDate(deal.meetingAt,'日程未定')),
    dealField('商談担当者',deal.staffId),
    dealField('IS担当者',deal.isPerson),
    dealField('現在フェーズ',deal.currentPhaseName||(deal.meetingId?'未開始':'商談前')),
    dealField('次回アクション',[deal.nextAction,dealDate(deal.nextActionAt,'')].filter(Boolean).join('｜')),
    dealField('最終更新',dealDate(deal.updatedAt,'—'))
  ]);
  return el('article',{class:'deal-card'},[head,fields,dealActions(deal)]);
}
function renderDeals(){
  const status=$('#deal-status-filter').value,keyword=$('#deal-search').value.trim();
  const items=deals.filter(deal=>(!status||deal.status===status)&&(!keyword||`${deal.storeName}${deal.ownerName}`.includes(keyword)));
  const list=$('#deal-list');list.textContent='';
  $('#active-deal-count').textContent=`${deals.length}件`;
  if(!items.length){list.append(el('div',{class:'empty-state'},[el('b',{text:'該当する案件はありません'}),el('p',{text:'「＋ 商談準備を作成」からISの引き継ぎを登録すると、ここに案件が追加されます。'})]));return}
  for(const deal of items)list.append(dealCard(deal));
}
function resultCard(deal){
  const head=el('div',{class:'deal-card-head'},[
    el('span',{class:`deal-status status-${deal.status}`,text:deal.status}),
    el('h3',{text:deal.storeName||'店舗名未入力'}),
    el('p',{text:[deal.ownerName&&`${deal.ownerName}様`,deal.staffId&&`担当 ${deal.staffId}`].filter(Boolean).join('｜')||'—'})
  ]);
  const fields=el('div',{class:'deal-fields'},[
    dealField('商談日',dealDate(deal.finishedAt||deal.startedAt,'—')),
    dealField('商談結果',deal.result),
    dealField('ヨミ',deal.forecast),
    dealField('獲得商材',deal.acquiredProducts),
    dealField('次回アクション',[deal.nextAction,dealDate(deal.nextActionAt,'')].filter(Boolean).join('｜')),
    dealField('最終更新',dealDate(deal.updatedAt,'—'))
  ]);
  const open=el('button',{class:'primary',type:'button',text:'結果と振り返りを見る'});
  open.addEventListener('click',()=>showResultDetail(deal.dealId));
  const remove=el('button',{class:'danger',type:'button',text:'削除'});
  remove.addEventListener('click',()=>confirmDeleteDeal(deal));
  return el('article',{class:'deal-card'},[head,fields,el('div',{class:'deal-actions-row'},[open,remove])]);
}
async function renderResults(){
  const list=$('#result-list');list.textContent='';
  const finished=(await api('/api/fs/deals?scope=finished')).deals;
  if(!finished.length){list.append(el('div',{class:'empty-state'},[el('b',{text:'終了した商談はまだありません'}),el('p',{text:'商談を終了すると、結果・メモ・振り返りがここに残ります。'})]));return}
  for(const deal of finished)list.append(resultCard(deal));
}
function preparationFocus(item){
  const text=[item.context_data.issues,item.context_data.hookPoints,item.handoff,item.context_data.appointmentPattern].join(' ');
  const results=[];
  const add=(id,reason)=>{if(!results.some(value=>value.id===id))results.push({id,reason})};
  if(/詳しく|不明|ほとんど|認識/.test(text))add('agenda','ISとの認識差をなくし、今日の進め方をそろえる');
  if(/不要|SNS|Google|必要性|売上|集客|客数|採用|人手|今後|課題|背景|独立|店舗|品質|デザイン|事例/.test(text))add('hp_interest','HPへの印象と今後の展望を聞き、事例でクオリティへの肯定を取る');
  if(/条件|無料|作りたい|興味/.test(text))add('company','HPが高額という前提を崩してから条件へ進む');
  if(/電気|料金|エネパル/.test(text))add('free_conditions','無料制作と電気切り替えの関係を正確に説明する');
  if(!results.length){add('company','HPへの現在の印象を確認する');add('hp_interest','今後の展望と事例でクオリティへの肯定を取る');add('free_conditions','無料の座組と条件を正確に説明する')}
  return results.slice(0,4);
}
async function showDealDetail(dealId){
  let detail;
  try{detail=await api(`/api/fs/deals/${encodeURIComponent(dealId)}`)}catch(error){return toast(error.message)}
  activeDeal=detail.deal;
  activePreparation=detail.preparation||{id:'',talk_script_id:detail.deal.talkScriptId,context_data:{},customer_name:detail.deal.storeName,owner_name:detail.deal.ownerName,staff_id:detail.deal.staffId,handoff:detail.deal.handoff,concerns:detail.deal.concerns,next_action:detail.deal.nextAction,next_action_at:detail.deal.nextActionAt,business_type:''};
  await loadScriptPhases(activePreparation.talk_script_id||detail.deal.talkScriptId);
  FsDealHeader.render({meta:$('#prep-detail-header-meta'),links:$('#prep-detail-header-links'),notes:$('#prep-detail-header-notes')},detail.deal);
  const context={...activePreparation.context_data,...detail.deal},focus=preparationFocus({context_data:{issues:detail.deal.issues,hookPoints:detail.deal.hookPoints,appointmentPattern:detail.deal.appointmentPattern},handoff:detail.deal.handoff});
  $('#prep-open-session').textContent=detail.deal.meetingId&&!detail.deal.finishedAt?'この案件で商談を再開 →':'この案件で商談を開始 →';
  $('#prep-open-session').hidden=Boolean(detail.deal.finishedAt);
  $('#prep-edit-info').hidden=!detail.preparation;
  $('#prep-detail-name').textContent=activePreparation.customer_name||'店舗名未入力';$('#prep-detail-meta').textContent=[activePreparation.owner_name&&`${activePreparation.owner_name}様`,activePreparation.business_type,activePreparation.staff_id&&`担当 ${activePreparation.staff_id}`,context.meetingAt&&new Date(context.meetingAt).toLocaleString('ja-JP')].filter(Boolean).join('｜');
  const meeting=context.meetingAt?new Date(context.meetingAt):null;$('#prep-detail-meeting').textContent=meeting?meeting.toLocaleString('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit'}):'日程未設定';if(meeting){const hours=(meeting-Date.now())/36e5;$('#prep-detail-countdown').textContent=hours>=0?(hours<24?`あと約${Math.max(1,Math.round(hours))}時間`:`あと${Math.ceil(hours/24)}日`):`${Math.ceil(Math.abs(hours)/24)}日前`}else $('#prep-detail-countdown').textContent='—';
  $('#prep-next-action').value=activePreparation.next_action||'';$('#prep-next-action-at').value=activePreparation.next_action_at||'';
  $('#prep-detail-temperature').textContent=context.temperature||'未確認';$('#prep-detail-temperature-reason').textContent=context.temperatureReason||'温度感の根拠は未入力です。';$('#prep-detail-issues').textContent=context.issues||activePreparation.concerns||'課題は未入力です。';$('#prep-detail-hooks').textContent=context.hookPoints||'刺しポイントは未入力です。商談中のヒアリングで確認してください。';$('#prep-detail-handoff').textContent=activePreparation.handoff||'ISからの引き継ぎはありません。';
  $('#prep-focus-phases').innerHTML=focus.map(({id,reason})=>{const phase=phaseById(id);return `<button data-prep-focus="${id}"><span>${phase?.name||id}</span><b>${reason}</b><small>スクリプトを確認 →</small></button>`}).join('');
  $$('[data-prep-focus]').forEach(button=>button.addEventListener('click',()=>{$('#preparation-dialog').close();openScriptPreview(activePreparation.talk_script_id,button.dataset.prepFocus)}));
  $('#preparation-dialog').showModal();
}
async function openDeal(deal){
  try{
    if(deal.preparationId){
      const data=await api(`/api/sales/preparations/${encodeURIComponent(deal.preparationId)}/open`,{method:'POST',body:'{}'});
      await enterSalesSession(data.session);
      await loadDeals();
      return toast(deal.meetingId?'中断した商談を再開しました':'案件情報とスクリプトを読み込みました');
    }
    if(!deal.meetingId)return toast('この案件には商談準備情報がありません');
    const detail=await api(`/api/fs/deals/${encodeURIComponent(deal.dealId||deal.meetingId)}`);
    await enterSalesSession(detail.session);
    await loadDeals();
    toast('商談を再開しました');
  }catch(error){toast(error.message)}
}
function fillPreparationForm(deal){
  const form=$('#preparation-form');form.reset();
  form.elements.departmentId.value='hd';form.elements.talkScriptId.value=deal.talkScriptId||selectedScript;
  const values={customerName:deal.storeName,ownerName:deal.ownerName,staffId:deal.staffId,isPerson:deal.isPerson,meetingAt:deal.meetingAt,targetProducts:deal.products,isNotes:deal.isNotes,address:deal.address,storePhone:deal.storePhone,mobile:deal.mobile,websiteUrl:deal.websiteUrl,instagramUrl:deal.instagramUrl,googleMapsUrl:deal.googleMapsUrl,existingHp:deal.existingHp,decisionMaker:deal.decisionMaker,temperature:deal.temperature,temperatureReason:deal.temperatureReason,issues:deal.issues,hookPoints:deal.hookPoints,concerns:deal.concerns,appointmentBackground:deal.appointmentBackground,appointmentPattern:deal.appointmentPattern,handoff:deal.handoff};
  for(const [name,value] of Object.entries(values))if(form.elements[name])form.elements[name].value=value||'';
  const links=Array.isArray(deal.otherLinks)?deal.otherLinks:[];
  if(form.elements.snsUrl)form.elements.snsUrl.value=links.find(item=>item.label==='その他SNS')?.url||'';
  if(form.elements.referenceUrl)form.elements.referenceUrl.value=links.find(item=>item.label==='参考資料')?.url||'';
  $('#handoff-analysis').hidden=true;
}
async function editDeal(dealId){
  try{
    const detail=await api(`/api/fs/deals/${encodeURIComponent(dealId)}`);
    if(!detail.preparation)return toast('この案件は商談準備情報を持っていないため編集できません');
    $('#preparation-dialog').close();
    editingDealId=detail.deal.dealId;
    fillPreparationForm(detail.deal);
    $('#prep-edit-target').textContent=detail.deal.storeName||'店舗名未入力';
    $('#prep-edit-banner').hidden=false;
    $('#save-preparation').textContent='変更を保存';
    show('preparation');
  }catch(error){toast(error.message)}
}
function resetPreparationForm(){
  const form=$('#preparation-form');form.reset();
  form.elements.departmentId.value='hd';form.elements.talkScriptId.value=selectedScript;
  editingDealId=null;$('#prep-edit-banner').hidden=true;$('#save-preparation').textContent='案件として保存';$('#handoff-analysis').hidden=true;
}
$('#cancel-prep-edit').addEventListener('click',resetPreparationForm);
function resultSection(title,value){
  return el('section',{class:'result-block'},[el('h3',{text:title}),el('p',{text:String(value||'').trim()||'—'})]);
}
// 終了後も原文メモを追記・編集・論理削除でき、履歴を残す
async function buildResultNotesSection(meetingId,dealId){
  const section=el('section',{class:'result-block'},[el('h3',{text:'商談メモ（原文）'})]);
  if(!meetingId){section.append(el('p',{text:'この案件には商談記録がありません。'}));return section}
  const list=el('div',{class:'note-list'});
  const reload=async()=>{
    try{
      const data=await api(`/api/fs/meetings/${encodeURIComponent(meetingId)}/notes`);
      renderNoteList(list,data.notes||[],{
        onEdit:note=>openNoteEditor(meetingId,note,()=>showResultDetail(dealId)),
        onDelete:async note=>{
          if(!window.confirm('このメモを削除しますか？（記録は残り、一覧から非表示になります）'))return;
          try{await api(`/api/fs/meetings/${encodeURIComponent(meetingId)}/notes/${encodeURIComponent(note.id)}`,{method:'DELETE'});toast('メモを削除しました');showResultDetail(dealId)}catch(error){toast(error.message)}
        },
        onHistory:note=>openNoteHistory(meetingId,note)
      });
    }catch(error){list.textContent='';list.append(el('p',{class:'muted small',text:error.message}))}
  };
  await reload();
  const input=el('textarea',{rows:'2',placeholder:'商談後の追記を入力'});
  const addButton=el('button',{class:'secondary',type:'button',text:'メモを追記'});
  addButton.addEventListener('click',async()=>{
    const content=input.value.trim();if(!content)return toast('追記するメモを入力してください');
    try{await api(`/api/fs/meetings/${encodeURIComponent(meetingId)}/notes`,{method:'POST',body:JSON.stringify({content,source:'post_meeting',author:'FS'})});input.value='';toast('メモを追記しました');showResultDetail(dealId)}catch(error){toast(error.message)}
  });
  section.append(list,el('div',{class:'note-add'},[input,addButton]));
  return section;
}
async function buildResultProductSection(meetingId,dealId){
  const section=el('section',{class:'result-block'},[el('h3',{text:'今回扱った商材'})]);
  if(!meetingId){section.append(el('p',{text:'—'}));return section}
  const container=el('div',{class:'product-checks'});
  let selected=[];
  try{selected=(await api(`/api/fs/meetings/${encodeURIComponent(meetingId)}/notes`)).products||[]}catch{}
  renderProductChecks(container,selected);
  const save=el('button',{class:'secondary',type:'button',text:'商材を保存'});
  save.addEventListener('click',async()=>{
    const products=[...container.querySelectorAll('input[type=checkbox]')].filter(box=>box.checked).map(box=>box.value);
    try{await api(`/api/fs/meetings/${encodeURIComponent(meetingId)}/products`,{method:'PUT',body:JSON.stringify({products,actor:'FS'})});toast('商材を保存しました');showResultDetail(dealId)}catch(error){toast(error.message)}
  });
  section.append(container,save);
  return section;
}
async function buildResultAnalysisSection(meetingId,dealId){
  const section=el('section',{class:'result-block analysis-block'},[el('h3',{text:'AIによる整理結果'})]);
  if(!meetingId){section.append(el('p',{text:'—'}));return section}
  const status=el('div',{class:'analysis-status'}),body=el('div',{class:'analysis-body'});
  let current=null;
  try{current=(await api(`/api/fs/meetings/${encodeURIComponent(meetingId)}/analysis`)).analysis}catch{}
  renderAnalysis(status,body,current);
  const run=el('button',{class:'secondary',type:'button',text:'AI解析を更新'});
  run.addEventListener('click',async()=>{
    // 担当者の修正版がある場合は、上書きしてよいか必ず確認する
    if(current?.edited_text&&!window.confirm('担当者が修正した解析結果があります。新しい解析を作成しますか？（修正版は履歴として残ります）'))return;
    run.disabled=true;
    try{const data=await api(`/api/fs/meetings/${encodeURIComponent(meetingId)}/analysis`,{method:'POST',body:JSON.stringify({actor:'FS'})});current=data.analysis;renderAnalysis(status,body,current);toast(data.text||'AI解析を更新しました')}
    catch(error){toast(error.message)}finally{run.disabled=false}
  });
  const edit=el('button',{class:'secondary',type:'button',text:'解析結果を編集'});
  edit.addEventListener('click',()=>{
    if(!current)return toast('先にAI解析を作成してください');
    openAnalysisEditor(meetingId,current,()=>showResultDetail(dealId));
  });
  section.append(status,body,el('small',{class:'muted analysis-disclaimer',text:'AI解析は原文メモをもとにした補助情報です。重要な判断は原文と実際の確認内容をもとに行ってください。'}),el('div',{class:'note-actions'},[run,edit]));
  return section;
}
let noteEditorTarget=null,analysisEditorTarget=null;
function openNoteEditor(meetingId,note,onSaved){
  noteEditorTarget={meetingId,noteId:note.id,onSaved};
  $('#note-edit-input').value=note.content;
  $('#note-edit-dialog').showModal();
}
$('#note-edit-form').addEventListener('submit',async event=>{
  if(event.submitter?.value!=='save'||!noteEditorTarget)return;
  const target=noteEditorTarget;noteEditorTarget=null;
  try{await api(`/api/fs/meetings/${encodeURIComponent(target.meetingId)}/notes/${encodeURIComponent(target.noteId)}`,{method:'PATCH',body:JSON.stringify({content:$('#note-edit-input').value,actor:'FS'})});toast('メモを更新しました');target.onSaved?.()}catch(error){toast(error.message)}
});
async function openNoteHistory(meetingId,note){
  const list=$('#note-history-list');list.textContent='';
  try{
    const data=await api(`/api/fs/meetings/${encodeURIComponent(meetingId)}/notes/${encodeURIComponent(note.id)}/revisions`);
    if(!data.revisions.length)list.append(el('p',{class:'muted small',text:'編集履歴はありません。'}));
    for(const revision of data.revisions)list.append(el('article',{class:'note-item'},[
      el('small',{text:`${noteTime(revision.edited_at)}｜${revision.edited_by||'担当者'}`}),
      el('p',{class:'note-before',text:`変更前：${revision.content_before}`}),
      el('p',{class:'note-body',text:`変更後：${revision.content_after}`})
    ]));
  }catch(error){list.append(el('p',{class:'muted small',text:error.message}))}
  $('#note-history-dialog').showModal();
}
function openAnalysisEditor(meetingId,analysis,onSaved){
  analysisEditorTarget={meetingId,analysisId:analysis.id,onSaved};
  $('#analysis-edit-input').value=analysis.edited_text||analysis.generated_text||'';
  $('#analysis-edit-dialog').showModal();
}
$('#analysis-edit-form').addEventListener('submit',async event=>{
  if(event.submitter?.value!=='save'||!analysisEditorTarget)return;
  const target=analysisEditorTarget;analysisEditorTarget=null;
  try{await api(`/api/fs/meetings/${encodeURIComponent(target.meetingId)}/analysis/${encodeURIComponent(target.analysisId)}`,{method:'PATCH',body:JSON.stringify({text:$('#analysis-edit-input').value,actor:'FS'})});toast('解析結果を保存しました（担当者修正済み）');target.onSaved?.()}catch(error){toast(error.message)}
});
async function showResultDetail(dealId){
  let detail;
  try{detail=await api(`/api/fs/deals/${encodeURIComponent(dealId)}`)}catch(error){return toast(error.message)}
  const deal=detail.deal,facts=detail.record?.facts||[];
  const factText=category=>facts.filter(item=>item.category===category).map(item=>item.value).join('\n');
  $('#result-detail-name').textContent=deal.storeName||'店舗名未入力';
  $('#result-detail-meta').textContent=[deal.ownerName&&`${deal.ownerName}様`,deal.staffId&&`担当 ${deal.staffId}`,deal.finishedAt&&`商談日 ${dealDate(deal.finishedAt)}`,deal.status].filter(Boolean).join('｜');
  FsDealHeader.render({meta:$('#result-detail-header-meta'),links:$('#result-detail-header-links'),notes:$('#result-detail-header-notes')},deal);
  const body=$('#result-detail-body');body.textContent='';
  const meetingId=deal.meetingId||detail.session?.id||'';
  const memos=await buildResultNotesSection(meetingId,dealId);
  const analysisBlock=await buildResultAnalysisSection(meetingId,dealId);
  const productBlock=await buildResultProductSection(meetingId,dealId);
  body.append(...[
    resultSection('ISからの引き継ぎ',deal.handoff),
    productBlock,
    deal.result?resultSection('商談結果（旧データ・参考）',deal.result):null,
    resultSection('ヨミ',deal.forecast),
    resultSection('制作意思・言質',factText('commitment')),
    resultSection('提案商材',factText('proposed_products')||deal.products),
    resultSection('獲得商材',factText('acquired_products')),
    resultSection('残った懸念',deal.concerns||factText('log')),
    resultSection('次回アクション',[deal.nextAction,dealDate(deal.nextActionAt,'')].filter(Boolean).join('｜')),
    memos,
    analysisBlock,
    resultSection('商談結果メモ',detail.session?.notes),
    resultSection('担当者の振り返り',deal.reflection)
  ].filter(Boolean));
  const handoffButton=el('button',{class:'secondary',type:'button',text:'進捗管理FMTを確認'});
  handoffButton.addEventListener('click',async()=>{$('#handoff-output').value=await buildHandoffFormat(detail.session,facts);$('#result-dialog').close();$('#handoff-dialog').showModal()});
  body.append(el('div',{class:'actions'},[handoffButton]));
  $('#result-dialog').showModal();
}
$('#close-note-history').addEventListener('click',()=>$('#note-history-dialog').close());
$('#close-result').addEventListener('click',()=>$('#result-dialog').close());
$('#close-result-bottom').addEventListener('click',()=>$('#result-dialog').close());
$('#close-preparation').addEventListener('click',()=>$('#preparation-dialog').close());
$('#prep-open-session').addEventListener('click',()=>{if(activeDeal){$('#preparation-dialog').close();openDeal(activeDeal)}});
$('#prep-edit-info').addEventListener('click',()=>{if(activeDeal)editDeal(activeDeal.dealId)});
$('#prep-view-script').addEventListener('click',()=>{if(activePreparation){$('#preparation-dialog').close();openScriptPreview(activePreparation.talk_script_id)}});
$('#save-next-action').addEventListener('click',async()=>{if(!activePreparation?.id)return toast('この案件は次の動きを保存できません');try{const data=await api(`/api/sales/preparations/${activePreparation.id}`,{method:'PUT',body:JSON.stringify({nextAction:$('#prep-next-action').value,nextActionAt:$('#prep-next-action-at').value,actor:activePreparation.staff_id||'FS'})});activePreparation=data.preparation;toast('次の動きを保存しました');await loadDeals();$('#preparation-dialog').close()}catch(error){toast(error.message)}});
function renderPhases(){
  const groups=[...new Set(config.phases.map(phase=>phase.group_name))];
  $('#phase-list').innerHTML=groups.map(group=>{
    const phases=config.phases.filter(phase=>phase.group_name===group);
    const groupName=phases[0]?.name.replace(/^③-\d\s*/,'')||'';
    if(group==='③'&&phases.length>1) return `<div class="phase-group"><div class="group-title"><span>${group}</span><b>HP興味付け・事例</b></div>${phases.map(phase=>`<button class="subphase" data-phase="${phase.id}"><span>${phase.name.match(/^③-\d/)?.[0]||''}</span><div><b>${phase.name.replace(/^③-\d\s*/,'')}</b></div></button>`).join('')}</div>`;
    return `<button data-phase="${phases[0].id}"><span>${group}</span><div><b>${groupName}</b><small>${phases[0].goal}</small></div></button>`;
  }).join('');
  $('#admin-phase-list').innerHTML=config.phases.map(phase=>`<button type="button" data-admin-phase="${phase.id}"><span>${String(phase.phase_order).padStart(2,'0')}</span>${phase.name}<small>v${phase.version}</small></button>`).join('');
  $('#return-select').innerHTML=config.phases.map(phase=>`<option value="${phase.id}">${phase.group_name==='③'?phase.name:`${phase.group_name} ${phase.name}`}</option>`).join('');
  $$('[data-phase]').forEach(button=>button.addEventListener('click',()=>selectPhase(button.dataset.phase)));
  $$('[data-admin-phase]').forEach(button=>button.addEventListener('click',()=>editPhase(button.dataset.adminPhase)));
}
function selectPhase(id){
  currentPhase=phaseById(id); if(!currentPhase)return;
  currentSection=null;
  $$('[data-phase]').forEach(button=>button.classList.toggle('active',button.dataset.phase===id));
  const owner=currentSession?.owner_name||'〇〇', hpRole=currentSession?.context_data?.hpRole||'　　　　　　　　　　　　　　';
  const script=formatScriptText(currentPhase.base_script.replaceAll('〇〇様',`${owner}様`).replaceAll('{{hpRole}}',hpRole));
  $('#phase-label').textContent=`PHASE ${currentPhase.group_name}${currentPhase.group_name==='③'&&config.phases.filter(p=>p.group_name==='③').length>1?` / STEP ${currentPhase.name.match(/\d/)?.[0]||''}`:''}`;$('#phase-name').textContent=currentPhase.name;$('#phase-goal').textContent=currentPhase.goal;$('#base-script').textContent=script;
  const stored=currentSession?.step_state?.[id]||[],checked=Array.isArray(stored)?stored:stored.checked||[],notes=Array.isArray(stored)?{}:stored.notes||{};
  $('#phase-questions').innerHTML=currentPhase.required_questions.map((item,index)=>{
    const note=notes[index]||{};
    return `<li class="question-note"><div class="question-head"><label><input type="checkbox" data-check="${index}" ${checked.includes(index)?'checked':''}><span>${item}</span></label></div><label>回答メモ<textarea rows="2" data-note-field="answer" data-note-index="${index}" placeholder="相手の回答を短く記録">${note.answer||''}</textarea></label><details><summary>詳細を残す（必要な時だけ）</summary><div class="compact-note-flags"><label><input type="checkbox" data-note-field="later" data-note-index="${index}" ${note.later?'checked':''}>後で確認</label><label><input type="checkbox" data-note-field="proposal" data-note-index="${index}" ${note.proposal?'checked':''}>提案に使用</label></div><div class="question-note-grid"><label>相手の発言をそのまま<textarea rows="2" data-note-field="verbatim" data-note-index="${index}">${note.verbatim||''}</textarea></label><label>担当者の補足<textarea rows="2" data-note-field="supplement" data-note-index="${index}">${note.supplement||''}</textarea></label><label>追加で深掘りする質問<textarea rows="2" data-note-field="deepQuestion" data-note-index="${index}">${note.deepQuestion||''}</textarea></label><div class="ai-note-box"><button type="button" data-organize-note="${index}" class="secondary">AIメモ整理</button><label>回答の要約<textarea rows="2" data-note-field="aiSummary" data-note-index="${index}">${note.aiSummary||''}</textarea></label><label>刺しポイント・不足情報<textarea rows="2" data-note-field="aiHint" data-note-index="${index}">${note.aiHint||''}</textarea></label></div></div></details></li>`;
  }).join('');
  $('#phase-transition').textContent=currentPhase.transition_conditions;$('#prohibited').innerHTML=currentPhase.prohibited_phrases.map(item=>`<span>${item}</span>`).join('');$('#warning-box').hidden=!currentPhase.prohibited_phrases.length;
  $('#return-select').value=id;
  $('#hp-role').value=currentSession?.context_data?.hpRole||'';$('#session-notes').value=currentSession?.notes||'';
  // 商談実行画面では中央のHPの役割・商談メモは表示しない（右側の商談メモへ統合済み）。データ自体は保持する。
  $('#context-fields').hidden=true;
  renderApplicationGuide();
  renderInterviewSection(id);
  renderReturnRecommendations();
  $('#objection-select').value=config.objections.find(item=>item.applicable_phase===id)?.id||'other';$('#suggestions').innerHTML='';currentSuggestion=null;
  closeQuickObjectionPopup();$('#quick-objection-input').value='';quickObjectionSuggestion=null;quickObjectionOffset=0;
  if(currentSession){currentSession.current_phase=id;scheduleProgressSave();FsMeetingNote.setPhase(id);renderMaterialBar()}
}
function applicationText(value,variant){
  return String(value||'').replaceAll('{{revisionLimit}}',variant.revisionLimit).replaceAll('{{continuationPeriod}}',variant.continuationPeriod).replaceAll('{{service}}',variant.service).replaceAll('【店舗名】',currentSession?.customer_name||'店舗名');
}
function applicationVariantId(){
  const target=[currentSession?.product_id,currentSession?.context_data?.targetProducts].filter(Boolean).join(' ');
  return /AMEX|カード|マスター|三井住友/i.test(target)&&!/エネパル/.test(target)?'card':'enepal';
}
function renderApplicationGuide(){
  const guide=catalog.applicationGuide, visible=currentPhase&&(currentPhase.id==='application'||/申込書/.test(currentPhase.name));
  $('#application-guide').hidden=!visible;
  if(!visible||!guide)return;
  const variantSelect=$('#application-variant');
  if(!variantSelect.options.length)variantSelect.innerHTML=Object.entries(guide.variants).map(([id,item])=>`<option value="${id}">${item.name}</option>`).join('');
  if(!variantSelect.dataset.selected){variantSelect.value=applicationVariantId();variantSelect.dataset.selected='1'}
  const variant=guide.variants[variantSelect.value]||guide.variants.enepal;
  $('#application-items').innerHTML=guide.sections.map(item=>`<button type="button" data-application-item="${item.number}" class="${item.number===applicationItem?'active':''}"><span>${item.number}</span>${item.title}</button>`).join('');
  const item=guide.sections.find(entry=>entry.number===applicationItem)||guide.sections[0];
  $('#application-item-detail').innerHTML=`<div class="application-item-title"><span>第${item.number}項</span><h3>${item.title}</h3></div><p class="application-summary">${item.summary}</p><div class="application-talk"><small>このまま話す</small><p>${applicationText(item.talk,variant)}</p></div><div class="application-checks"><small>確認ポイント</small>${item.checks.map(check=>`<label><input type="checkbox"> ${applicationText(check,variant)}</label>`).join('')}</div>`;
  $('#application-source').href=guide.source.url;
  $$('[data-application-item]').forEach(button=>button.addEventListener('click',()=>{applicationItem=Number(button.dataset.applicationItem);renderApplicationGuide()}));
}
function renderReturnRecommendations(){
  const map={
    hp_interest:[['company','② 会社紹介・なぜ今HP'],['hp_interest','③ HPに対する興味付け']],
    free_conditions:[['hp_interest','③ HPに対する興味付け'],['free_conditions','④ 条件ばらし']],
    application:[['application','⑤ 申込書の該当項目'],['free_conditions','④ 無料の仕組み・条件']]
  };
  const items=map[currentPhase?.id]||[];
  $('#recommended-returns').innerHTML=items.length?`<b>おすすめの戻り先</b><div>${items.map(([id,label])=>`<button data-recommended="${id}">${label}</button>`).join('')}</div>`:'';
  $$('[data-recommended]').forEach(button=>button.addEventListener('click',()=>selectPhase(button.dataset.recommended)));
}
function editPhase(id){
  const phase=phaseById(id), form=$('#phase-form');if(!phase)return;
  $$('[data-admin-phase]').forEach(button=>button.classList.toggle('active',button.dataset.adminPhase===id));
  form.elements.id.value=phase.id;form.elements.name.value=phase.name;form.elements.goal.value=phase.goal;form.elements.baseScript.value=phase.base_script;form.elements.requiredQuestions.value=phase.required_questions.join('\n');form.elements.transitionConditions.value=phase.transition_conditions;form.elements.prohibitedPhrases.value=phase.prohibited_phrases.join('\n');
}
async function loadDeals(){
  deals=(await api('/api/fs/deals')).deals;
  renderDeals();
  return deals;
}
async function load(){
  [config,catalog]=await Promise.all([api('/api/sales/config'),api('/api/sales/catalog')]);renderPhases();renderCatalog();
  renderHomeTemplates();renderPreparationScriptSelector();
  $('#objection-select').innerHTML=config.objections.map(item=>`<option value="${item.id}">${item.category} ＞ ${item.subcategory}</option>`).join('');
  selectPhase('agenda');editPhase('agenda');
  const [sessionsData]=await Promise.all([api('/api/sales/sessions'),loadDeals(),renderResults()]);
  const sessions=sessionsData.sessions;
  $('#today-count').textContent=`${sessions.filter(item=>item.started_at?.slice(0,10)===new Date().toISOString().slice(0,10)).length}件`;
}
$('#deal-status-filter').addEventListener('change',renderDeals);
$('#deal-search').addEventListener('input',renderDeals);
$('#toggle-script-admin').addEventListener('click',()=>{const panel=$('#script-admin');panel.hidden=!panel.hidden;$('#toggle-script-admin').textContent=panel.hidden?'管理メニューを表示':'管理メニューを隠す'});
$$('[data-template-tab]').forEach(button=>button.addEventListener('click',()=>{
  const tab=button.dataset.templateTab;
  $$('[data-template-tab]').forEach(item=>item.classList.toggle('active',item===button));
  $('#template-tab-scripts').hidden=tab!=='scripts';
  $('#template-tab-materials').hidden=tab!=='materials';
  $('#toggle-script-admin').hidden=tab!=='scripts';
  if(tab==='materials')loadMaterialAdmin();
}));

// ===== 商談資料 =====
const MATERIAL_OPTIONS={
  category:{'':'すべて',...FsMaterials.labels.category},
  product:{'':'すべて',...FsMaterials.labels.product},
  sourceType:FsMaterials.labels.sourceType,
  visibility:FsMaterials.labels.visibility
};
function fillOptions(select,entries,selected){
  if(!select)return;
  select.textContent='';
  for(const [value,label] of Object.entries(entries))select.append(el('option',{value,text:label}));
  if(selected!==undefined)select.value=selected;
}
function materialQuery(params){
  const query=new URLSearchParams();
  for(const [key,value] of Object.entries(params))if(value!==''&&value!==undefined&&value!==null)query.set(key,value);
  return query.toString()?`?${query}`:'';
}
async function copyMaterialLink(material,button){
  try{await navigator.clipboard.writeText(material.url);button.textContent='コピーしました';setTimeout(()=>{button.textContent='リンクをコピー'},1800)}
  catch{toast('リンクをコピーできませんでした')}
}
const materialHandlers=admin=>({
  onCopy:copyMaterialLink,
  onEdit:admin?openMaterialForm:undefined,
  onToggle:admin?async material=>{
    try{await api(`/api/fs/materials/${encodeURIComponent(material.id)}/status`,{method:'PATCH',body:JSON.stringify({active:!material.active,actor:'管理者'})});await loadMaterialAdmin();toast(material.active?'資料を停止しました':'資料を再開しました')}
    catch(error){toast(error.message)}
  }:undefined
});
async function loadMaterialAdmin(){
  fillOptions($('#material-filter-category'),MATERIAL_OPTIONS.category,$('#material-filter-category').value||'');
  fillOptions($('#material-filter-product'),MATERIAL_OPTIONS.product,$('#material-filter-product').value||'');
  try{
    const data=await api(`/api/fs/materials${materialQuery({viewer:'admin',category:$('#material-filter-category').value,product:$('#material-filter-product').value,keyword:$('#material-filter-keyword').value.trim(),active:$('#material-filter-active').value})}`);
    FsMaterials.renderGroups($('#material-admin-list'),data.materials,materialHandlers(true));
  }catch(error){FsMaterials.renderGroups($('#material-admin-list'),[]);toast(error.message)}
}
['#material-filter-category','#material-filter-product','#material-filter-active'].forEach(id=>$(id).addEventListener('change',loadMaterialAdmin));
$('#material-filter-keyword').addEventListener('input',loadMaterialAdmin);
function openMaterialForm(material){
  const form=$('#material-form');form.reset();
  fillOptions(form.elements.category,FsMaterials.labels.category);
  fillOptions(form.elements.product,FsMaterials.labels.product);
  fillOptions(form.elements.sourceType,FsMaterials.labels.sourceType);
  fillOptions(form.elements.visibility,FsMaterials.labels.visibility);
  $('#material-form-message').textContent='';
  $('#material-form-title').textContent=material?.id?'資料を編集':'資料を追加';
  form.elements.id.readOnly=Boolean(material?.id);
  if(material?.id){
    for(const name of ['id','title','url','description','sourceTitle','sortOrder'])if(form.elements[name])form.elements[name].value=material[name]??'';
    for(const name of ['category','product','sourceType','visibility'])if(form.elements[name])form.elements[name].value=material[name];
    form.elements.phaseTags.value=(material.phaseTags||[]).join(', ');
    form.elements.active.value=String(material.active);
  }
  $('#material-form-dialog').showModal();
}
$('#open-material-form').addEventListener('click',()=>openMaterialForm(null));
$('#close-material-form').addEventListener('click',()=>$('#material-form-dialog').close());
$('#material-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget,raw=Object.fromEntries(new FormData(form));
  const body={...raw,sortOrder:Number(raw.sortOrder)||999,active:raw.active==='true',customerShareable:raw.visibility==='customer_shareable',phaseTags:raw.phaseTags.split(/[,、\s]+/).filter(Boolean),actor:'管理者'};
  try{
    await api(`/api/fs/materials${form.elements.id.readOnly?`/${encodeURIComponent(body.id)}`:''}`,{method:form.elements.id.readOnly?'PUT':'POST',body:JSON.stringify(body)});
    $('#material-form-dialog').close();await loadMaterialAdmin();toast('資料を保存しました');
  }catch(error){$('#material-form-message').textContent=error.message}
});
async function logMaterialOpen(materialId){
  if(!currentSession||!materialId)return;
  try{await api(`/api/fs/materials/${encodeURIComponent(materialId)}/open-log`,{method:'POST',body:JSON.stringify({meetingId:currentSession.id,phaseId:currentPhase?.id||'',sectionId:currentSection||''})})}catch{}
}
async function renderMaterialBar(){
  const bar=$('#material-bar');
  if(!currentSession)return FsMaterials.renderBar(bar,[],{message:'商談開始後に表示されます'});
  // 資料の取得に失敗しても商談画面は止めない
  try{
    const params={phaseId:currentPhase?.id||'',limit:4};
    if(currentSection)params.sectionId=currentSection;
    if(currentPhase?.id==='interview_phase_10'&&currentSection==='phase_10_card_branch'&&phase10State.selectedCardProduct)params.cardProductOverride=phase10State.selectedCardProduct;
    const data=await api(`/api/fs/meetings/${encodeURIComponent(currentSession.id)}/materials${materialQuery(params)}`);
    FsMaterials.renderBar(bar,data.materials,{onOpenAll:()=>openMaterialsDialog(),onOpen:material=>logMaterialOpen(material.id),message:'なし'});
  }catch{FsMaterials.renderBar(bar,[],{onOpenAll:()=>openMaterialsDialog(),message:'資料を読み込めませんでした'})}
}
const INTERVIEW_FIELD_LABELS={openedAtAndReason:'①開業時期・開業のきっかけ',strengthAndConcept:'②店舗の強み・コンセプト',recommendedProducts:'③おすすめ商品・メニュー',targetCustomers:'④増やしたいターゲット',futureVision:'⑤今後の展望',currentChallenges:'⑥現在の課題・理想とのギャップ'};
const PHASE10_SECTION_NAMES={phase_10_scheme:'①無料制作の仕組み',phase_10_provider_check:'②現在の電力会社確認',phase_10_electricity_offer:'③エネパルの提案',phase_10_card_branch:'④カード・アフィリエイト（任意）',phase_10_application_form:'⑤申込書説明',phase_10_objection_pre_screening:'⑥申込前の懸念確認',phase_10_line_cloudsign:'⑦LINE・クラウドサイン'};
const PHASE10_SECTION_SCRIPTS={
  phase_10_scheme:`ここから、今回なぜホームページを無料で制作できるのかと、制作にあたっての条件をご説明します。\n\n本来、ホームページ制作には、デザイナーやエンジニアの人件費、制作費、公開作業などの費用がかかります。\n\n今回は、店舗様からホームページの制作費をいただく代わりに、弊社が提携している会社から事業支援金をいただき、その支援金を制作費に充てる仕組みになっています。\n\n今回ご案内している提携先が、エネパルという電力会社です。\n\n現在お使いの電力会社からエネパルへお切り替えいただくことで、弊社に事業支援金が入り、その支援金をホームページの制作費に充てます。\n\nつまり、今回の無料制作の条件としては、\n\n「エネパルへの電気切り替えにご協力いただき、その代わりに弊社がホームページを無料で制作する」\n\nという内容になります。\n\nもちろん、現在の電気契約や明細を確認したうえで、対象プラン、料金、契約期間、解約条件などは正式にご説明します。\n\nこの条件で、ホームページ制作を進めさせていただいてもよろしいでしょうか？\n\n【料金が高くならないかと言われた場合】\n現時点で必ず安くなるとはお伝えできませんので、現在の明細と、エネパルの対象プランを確認したうえで比較します。\n\n【電気は変えたくないと言われた場合】\n理由は、現在の会社に満足、過去に料金が上がった、知人や取引先との関係、手続きや契約期間への不安、そもそも変えたくない、のどれが一番近いですか？`,
  phase_10_provider_check:`それでは、現在ご利用の電力会社について確認させてください。\n\n現在の電力会社はどちらでしょうか？\n\n契約名義はオーナー様でよろしかったでしょうか？\n\n現在の契約に、契約期間や解約に関する条件はありますか？\n\n電気の請求書や明細はお手元にありますか？\n\n明細があれば、月額の費用を確認させてください。\n\n電気の請求先は、このお店の住所でよろしかったでしょうか？`,
  phase_10_electricity_offer:`ありがとうございます。\n\n確認した内容をもとに、エネパルの対象プランと料金をご説明します。\n\n【エネパル料金表・関東エリア資料を表示】\n\n現在の電力会社の料金と、エネパルの対象プランを比較します。\n\n現時点で必ず安くなるとはお伝えできませんが、対象プランを確認したうえで、料金の違いをご説明します。\n\n契約期間、解約条件、サポート内容についても、正式情報の範囲でご説明します。\n\nご不明な点は、この場で分かる範囲でお答えします。確認が必要な事項は、持ち帰って後日ご連絡します。\n\nエネパルへの切り替えについて、条件面で問題はありそうですか？`,
  phase_10_card_branch:`ここまでが、ホームページ制作とエネパルに関するお手続きの確認です。\n\nここからは、ホームページ制作とは別の、任意のご協力依頼になります。\n\nこちらにお申し込みいただかなくても、先ほどのホームページ制作条件には影響しません。\n\n現在、弊社ではAMEX、三井住友ビジネスオーナーズカード、ACマスターカードのご案内も行っているのですが、内容だけお聞きいただくことはできますか？\n\n興味がない場合は、任意のご案内なので問題ありません。興味がある場合のみ、年会費、特典、審査、申込条件などを正式な資料に沿ってご説明します。`,
  phase_10_application_form:`ありがとうございます。\n\nそれでは、先ほどお話しした内容を口頭だけで終わらせず、無料で制作することを双方で確認できるように、申込書を一緒に読み合わせさせていただきます。\n\n今、画面は見えていますか？\n\nありがとうございます。\n\n少し文章が多いんですけど、全部をそのまま読み上げるというよりは、大事な部分をこちらから分かりやすくご説明していきます。\n\n途中で分からない部分や、もう一度確認したい部分があれば、その都度止めていただいて大丈夫です。\n\n内容に問題がなければ、最後に今見ていただいている申込書と同じものをクラウドサインでお送りします。\n\nそちらにご署名いただいて、正式なお申し込み完了という流れになります。`,
  phase_10_objection_pre_screening:`申込書の読み合わせが終わりました。\n\nここまでの内容で、何かご不明な点や気になる点はありますか？\n\n【電気の切り替えが心配な場合】\n電気の切り替えについては、現在の明細と今回のプランを確認したうえで、料金や条件に問題がないことを確認してから進めます。\n\n条件に問題があった場合は、お申し込み自体が無効になりますので、費用が発生することはありません。\n\n【HPの内容が心配な場合】\nHPの制作範囲と修正の条件は、先ほど申込書でご確認いただいた通りです。\n\n初稿が出来上がった段階で内容を確認いただき、1回まで修正が可能です。\n\n【サインの前に確認したいと言われた場合】\n確認が必要な点をまとめて、後日回答します。\n\n確認後にご署名いただく形で問題ありません。`,
  phase_10_line_cloudsign:`ありがとうございます。\n\nこの後のホームページ制作に関するご連絡や、必要な情報のご案内を行うために、弊社の公式LINEを追加していただきます。\n\n今、こちらのURLは開けますか？\n\nhttps://line.me/R/ti/p/@348hkufo\n\n追加後、LINE上でオーナー様のお名前と店舗名を一度お送りいただけますか？\n\n続いて、クラウドサインで申込書をお送りしますので、受信可能なメールアドレスを確認させてください。\n\nメールアドレスは、〇〇でお間違いないですか？\n\n【クラウドサイン確認】\n今、クラウドサインからメールが届いているか、ご確認いただけますか？\n\nメールを開いていただくと、書類を確認するボタンがありますので、そちらを押してください。\n\n先ほど一緒に読み合わせた内容と、記載内容に相違がないか、改めてご確認ください。\n\n不明点があれば、署名前に必ずおっしゃってください。\n\n内容に問題がなければ、同意・署名のお手続きをお願いします。`
};
function renderInterviewSection(phaseId){
  const section=$('#interview-section');
  section.hidden=true;section.textContent='';
  if(!currentSession)return;
  if(phaseId==='interview_phase_08'){section.hidden=false;renderInterviewForm(section)}
  else if(phaseId==='interview_phase_09'){section.hidden=false;renderInterviewAnswers(section)}
  else if(phaseId==='interview_phase_10'){section.hidden=false;renderPhase10Nav(section)}
}
async function renderInterviewForm(container){
  if(!interviewData||!Object.keys(interviewData).length){
    try{const data=await api(`/api/fs/meetings/${encodeURIComponent(currentSession.id)}/interview`);interviewData={...data.data}}catch{}
  }
  container.textContent='';
  const header=el('div',{class:'interview-form-header'},[el('span',{class:'eyebrow',text:'INTERVIEW'}),el('h3',{text:'インタビュー記録'}),el('p',{text:'6項目を入力してください。入力内容は自動保存されます。'})]);
  const form=el('div',{class:'interview-form'});
  for(const [key,label] of Object.entries(INTERVIEW_FIELD_LABELS)){
    const textarea=el('textarea',{rows:3,placeholder:`${label}の内容を記録`,'data-interview-field':key});
    textarea.textContent=interviewData[key]||'';
    textarea.addEventListener('input',()=>{interviewData[key]=textarea.value;scheduleInterviewSave()});
    form.append(el('label',{class:'interview-field'},[el('span',{text:label}),textarea]));
  }
  container.append(header,form);
}
function scheduleInterviewSave(){
  clearTimeout(interviewSaveTimer);
  interviewSaveTimer=setTimeout(async()=>{
    if(!currentSession)return;
    try{await api(`/api/fs/meetings/${encodeURIComponent(currentSession.id)}/interview`,{method:'PUT',body:JSON.stringify(interviewData)})}catch{}
  },500);
}
async function renderInterviewAnswers(container){
  if(!Object.keys(interviewData).length){
    try{const data=await api(`/api/fs/meetings/${encodeURIComponent(currentSession.id)}/interview`);interviewData={...data.data}}catch{}
  }
  container.textContent='';
  const hasData=Object.values(INTERVIEW_FIELD_LABELS).some((_,i)=>interviewData[Object.keys(INTERVIEW_FIELD_LABELS)[i]]);
  const header=el('div',{class:'interview-answers-header'},[el('span',{class:'eyebrow',text:'INTERVIEW REFERENCE'}),el('h3',{text:'⑧インタビュー内容（参照用）'})]);
  const answers=el('div',{class:'interview-answers'});
  if(!hasData){answers.append(el('p',{class:'muted small',text:'⑧フェーズでインタビューを記録してください。'}));container.append(header,answers);return}
  for(const [key,label] of Object.entries(INTERVIEW_FIELD_LABELS)){
    const value=interviewData[key]||'';
    answers.append(el('div',{class:'interview-answer-item'},[el('small',{text:label}),el('p',{text:value||'（未記録）'})]));
  }
  container.append(header,answers);
}
function renderPhase10Nav(container){
  const stored=currentSession?.step_state?.interview_phase_10_meta||{};
  phase10State={electricityProvider:'',electricityEligibility:'unknown',monthlyElectricityCost:'',selectedCardProduct:null,applicationFormReviewed:false,officialLineAdded:false,cloudsignSent:false,cloudsignSigned:false,...stored};
  const nav=el('div',{class:'phase10-section-nav'});
  const navHeader=el('div',{class:'phase10-nav-header'},[el('span',{class:'eyebrow',text:'SECTION'}),el('span',{text:'進行中のセクションを選択してください'})]);
  const buttons=el('div',{class:'phase10-nav-buttons'});
  for(const [id,name] of Object.entries(PHASE10_SECTION_NAMES)){
    const btn=el('button',{class:`phase10-section-btn${currentSection===id?' active':''}`,type:'button',text:name,'data-section':id});
    btn.addEventListener('click',()=>selectSection(id));
    buttons.append(btn);
  }
  nav.append(navHeader,buttons);
  const contentArea=el('div',{id:'phase10-section-content',class:'phase10-section-content'});
  if(currentSection){renderPhase10SectionContent(contentArea,currentSection)}
  else contentArea.append(el('p',{class:'muted small',text:'上のセクションボタンを押すと、そのセクションのスクリプトと資料が表示されます。'}));
  container.append(nav,contentArea);
}
async function selectSection(sectionId){
  currentSection=sectionId;
  // Update nav button active state
  $$('.phase10-section-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.section===sectionId));
  const contentArea=$('#phase10-section-content');
  if(contentArea)renderPhase10SectionContent(contentArea,sectionId);
  renderMaterialBar();
}
function renderPhase10SectionContent(container,sectionId){
  container.textContent='';
  const script=PHASE10_SECTION_SCRIPTS[sectionId]||'';
  const scriptBox=el('div',{class:'script-box document-script phase10-section-script'});
  scriptBox.textContent=formatScriptText(script);
  container.append(el('div',{class:'phase10-section-header'},[el('b',{text:PHASE10_SECTION_NAMES[sectionId]||sectionId})]),scriptBox);
  if(sectionId==='phase_10_provider_check')renderElectricityStateForm(container);
  if(sectionId==='phase_10_card_branch')renderCardSelection(container);
  if(sectionId==='phase_10_line_cloudsign')renderPhase10Checklist(container);
}
function renderElectricityStateForm(container){
  const form=el('div',{class:'phase10-state-form'});
  form.append(el('span',{class:'eyebrow',text:'ELECTRICITY INFO'}));
  const fieldDefs=[
    {key:'electricityProvider',label:'現在の電力会社',type:'text',placeholder:'例：東京電力'},
    {key:'monthlyElectricityCost',label:'月額電気代（円）',type:'text',placeholder:'例：15000'}
  ];
  for(const {key,label,type,placeholder} of fieldDefs){
    const input=el('input',{type,placeholder,value:phase10State[key]||''});
    input.addEventListener('input',()=>{phase10State[key]=input.value;savePhase10State()});
    form.append(el('label',{class:'phase10-state-field'},[el('small',{text:label}),input]));
  }
  const eligLabel=el('small',{text:'エネパル切替の可否'});
  const eligSelect=el('select');
  [['unknown','未確認'],['eligible','切替可能'],['ineligible_existing_group','既存グループ契約・対象外'],['needs_manual_review','要個別確認']].forEach(([value,label])=>{
    const opt=el('option',{value,text:label});if(phase10State.electricityEligibility===value)opt.selected=true;eligSelect.append(opt);
  });
  eligSelect.addEventListener('change',()=>{phase10State.electricityEligibility=eligSelect.value;savePhase10State()});
  form.append(el('label',{class:'phase10-state-field'},[eligLabel,eligSelect]));
  container.append(form);
}
function renderCardSelection(container){
  const cardSection=el('div',{class:'phase10-card-section'});
  cardSection.append(el('span',{class:'eyebrow',text:'CARD SELECTION'}));
  if(!phase10State.selectedCardProduct){
    cardSection.append(el('p',{class:'small',text:'案内するカードを選択すると、対応する資料が表示されます。（任意）'}));
    const buttons=el('div',{class:'phase10-card-buttons'});
    [['amex','AMEX'],['smbc_business_owners','三井住友'],['ac_mastercard','AC']].forEach(([product,label])=>{
      const btn=el('button',{class:'phase10-card-btn',type:'button',text:label});
      btn.addEventListener('click',()=>{phase10State.selectedCardProduct=product;savePhase10State();renderMaterialBar();container.querySelector('.phase10-card-section').replaceWith(buildCardSelected());});
      buttons.append(btn);
    });
    cardSection.append(buttons);
  }else{
    const selected=buildCardSelected();container.append(selected);return;
  }
  container.append(cardSection);
}
function buildCardSelected(){
  const names={amex:'AMEX',smbc_business_owners:'三井住友ビジネスオーナーズ',ac_mastercard:'ACマスターカード'};
  const div=el('div',{class:'phase10-card-section phase10-card-selected'});
  div.append(el('span',{class:'eyebrow',text:'CARD SELECTION'}));
  div.append(el('b',{text:`選択中：${names[phase10State.selectedCardProduct]||phase10State.selectedCardProduct}`}));
  const clear=el('button',{class:'secondary small',type:'button',text:'選択を解除'});
  clear.addEventListener('click',()=>{phase10State.selectedCardProduct=null;savePhase10State();renderMaterialBar();const contentArea=$('#phase10-section-content');if(contentArea&&currentSection)renderPhase10SectionContent(contentArea,currentSection)});
  div.append(clear);
  return div;
}
function renderPhase10Checklist(container){
  const checks=el('div',{class:'phase10-checklist'});
  checks.append(el('span',{class:'eyebrow',text:'COMPLETION CHECKLIST'}));
  const checkDefs=[
    {key:'officialLineAdded',label:'公式LINEを追加した'},
    {key:'cloudsignSent',label:'クラウドサインを送付した'},
    {key:'cloudsignSigned',label:'クラウドサインへの署名が完了した'}
  ];
  for(const {key,label} of checkDefs){
    const input=el('input',{type:'checkbox'});
    if(phase10State[key])input.checked=true;
    input.addEventListener('change',()=>{phase10State[key]=input.checked;savePhase10State()});
    checks.append(el('label',{class:'phase10-check'},[input,el('span',{text:label})]));
  }
  container.append(checks);
}
function savePhase10State(){
  if(!currentSession)return;
  currentSession.step_state={...(currentSession.step_state||{}),interview_phase_10_meta:phase10State};
  scheduleProgressSave();
}
async function openMaterialsDialog(){
  fillOptions($('#materials-dialog-category'),MATERIAL_OPTIONS.category,$('#materials-dialog-category').value||'');
  fillOptions($('#materials-dialog-product'),MATERIAL_OPTIONS.product,$('#materials-dialog-product').value||'');
  $('#materials-dialog').showModal();
  await refreshMaterialsDialog();
}
async function refreshMaterialsDialog(){
  try{
    const data=await api(`/api/fs/materials${materialQuery({active:'true',category:$('#materials-dialog-category').value,product:$('#materials-dialog-product').value,keyword:$('#materials-dialog-keyword').value.trim()})}`);
    $('#materials-dialog-meta').textContent=`${data.materials.length}件｜資料は新しいタブで開きます`;
    FsMaterials.renderGroups($('#materials-dialog-list'),data.materials,{onCopy:copyMaterialLink});
  }catch(error){FsMaterials.renderGroups($('#materials-dialog-list'),[]);$('#materials-dialog-meta').textContent=error.message}
}
['#materials-dialog-category','#materials-dialog-product'].forEach(id=>$(id).addEventListener('change',refreshMaterialsDialog));
$('#materials-dialog-keyword').addEventListener('input',refreshMaterialsDialog);
$('#close-materials').addEventListener('click',()=>$('#materials-dialog').close());
$('#application-variant').addEventListener('change',()=>renderApplicationGuide());
async function renderDealHeader(){
  const targets={owner:$('#deal-header-owner'),meta:$('#deal-header-meta'),links:$('#deal-header-links'),notes:$('#deal-header-notes'),notesLabel:'事前情報'};
  if(!currentSession)return FsDealHeader.render(targets,{});
  try{
    const detail=await api(`/api/fs/deals/${encodeURIComponent(currentSession.deal_id||currentSession.id)}`);
    activeDeal=detail.deal;FsDealHeader.render(targets,detail.deal);
  }catch{
    const context=currentSession.context_data||{};
    FsDealHeader.render(targets,{ownerName:currentSession.owner_name,staffId:currentSession.staff_id,handoff:currentSession.handoff,...context,products:context.targetProducts,meetingAt:context.meetingAt});
  }
}
async function enterSalesSession(session){
  currentSession=session;interviewData={};phase10State={};currentSection=null;
  $('#predicted-objections').innerHTML='<p class="muted small">メモを入力して「AI整理して保存」を押すと、要約・言質・懸念がここに表示されます。</p>';
  await loadScriptPhases(currentSession.talk_script_id);renderPhases();const script=catalog.scripts.find(item=>item.id===currentSession.talk_script_id),department=catalog.departments.find(item=>item.id===currentSession.department_id);$('#session-customer').textContent=currentSession.customer_name||'店舗名未入力';$('#session-meta').textContent=[department?.name,script?.name,currentSession.talk_script_version,currentSession.context_data?.appointmentPattern&&`IS：${currentSession.context_data.appointmentPattern}`,currentSession.staff_id&&`担当 ${currentSession.staff_id}`].filter(Boolean).join(' ・ ');selectPhase(phaseById(currentSession.current_phase)?currentSession.current_phase:config.phases[0]?.id);show('assist');loadSessionRecord();loadTalkObjectionNotes();
  storage.set(ACTIVE_MEETING_KEY,currentSession.id);
  await Promise.all([renderDealHeader(),renderMaterialBar(),FsMeetingNote.open(currentSession.id,currentSession.current_phase)]);
}
function analyzeCurrentHandoff(){const text=$('#is-template-paste').value.trim();if(!text)return {};return applyIsTemplate(text)}
async function savePreparation(){
  const form=$('#preparation-form');
  if(!form.reportValidity())return null;
  analyzeCurrentHandoff();
  const body=Object.fromEntries(new FormData(form));
  if(editingDealId){
    const data=await api(`/api/fs/deals/${encodeURIComponent(editingDealId)}`,{method:'PUT',body:JSON.stringify({...body,actor:body.staffId||'FS'})});
    return { preparation:data.preparation, edited:true };
  }
  return { preparation:(await api('/api/sales/preparations',{method:'POST',body:JSON.stringify(body)})).preparation, edited:false };
}
$('#preparation-form').addEventListener('submit',async event=>{
  event.preventDefault();
  try{
    const saved=await savePreparation();if(!saved)return;
    const data=await api(`/api/sales/preparations/${encodeURIComponent(saved.preparation.id)}/open`,{method:'POST',body:'{}'});
    resetPreparationForm();await loadDeals();
    await enterSalesSession(data.session);
    toast('案件を保存して商談を開始しました');
  }catch(error){toast(error.message)}
});
$('#save-preparation').addEventListener('click',async()=>{
  try{
    const saved=await savePreparation();if(!saved)return;
    resetPreparationForm();await loadDeals();
    toast(saved.edited?'案件情報を更新しました':'案件を各種案件用へ追加しました');
    show('deals');
  }catch(error){toast(error.message)}
});
$('#analyze-is-handoff').addEventListener('click',()=>{const text=$('#is-template-paste').value.trim();if(!text)return toast('ISからの引き継ぎを貼り付けてください');applyIsTemplate(text);toast('IS引き継ぎを解析し、空欄へ反映しました')});
$('#is-template-paste').addEventListener('input',()=>{$('#handoff-analysis').hidden=true;$('#analysis-status').textContent='未解析'});
$('#admin-department-filter').addEventListener('change',renderAdminScripts);$('#admin-status-filter').addEventListener('change',renderAdminScripts);
$('#preparation-script-select').addEventListener('change',()=>{scriptSelectionTouched=true;selectedScript=$('#preparation-script-select').value;$('#preparation-form').elements.talkScriptId.value=selectedScript;renderPreparationScriptSummary()});
$('#preparation-show-archived').addEventListener('change',renderPreparationScriptSelector);
$('#preview-preparation-script').addEventListener('click',()=>openScriptPreview($('#preparation-script-select').value));
function scheduleProgressSave(){
  if(!currentSession)return;clearTimeout(saveTimer);saveTimer=setTimeout(saveProgress,350);
}
async function saveProgress(){
  if(!currentSession)return;
  const body={currentPhase:currentPhase?.id,contextData:{hpRole:$('#hp-role').value},stepState:currentSession.step_state||{},notes:$('#session-notes').value};
  try{currentSession=(await api(`/api/sales/sessions/${currentSession.id}/progress`,{method:'PUT',body:JSON.stringify(body)})).session}catch(error){toast(error.message)}
}
$('#phase-questions').addEventListener('change',event=>{
  if(!currentSession||!event.target.matches('[data-check],[data-note-field]'))return;
  storeCurrentQuestionNotes();
});
$('#phase-questions').addEventListener('input',event=>{if(currentSession&&event.target.matches('[data-note-field]'))storeCurrentQuestionNotes()});
$('#phase-questions').addEventListener('click',event=>{
  const button=event.target.closest('[data-organize-note]');if(!button||!currentSession)return;
  const index=Number(button.dataset.organizeNote),answer=$(`[data-note-field="answer"][data-note-index="${index}"]`).value.trim(),verbatim=$(`[data-note-field="verbatim"][data-note-index="${index}"]`).value.trim();
  $(`[data-note-field="aiSummary"][data-note-index="${index}"]`).value=answer||verbatim||'回答がまだ入力されていません';
  $(`[data-note-field="aiHint"][data-note-index="${index}"]`).value=answer?`提案時に「${answer.slice(0,80)}」を相手の言葉として活用。具体的な理由・時期・優先度が未確認なら追加で聞く。`:'相手の回答を入力すると、刺しポイントと不足情報を整理できます。';
  storeCurrentQuestionNotes();toast('メモを整理しました。編集して保存できます');
});
function storeCurrentQuestionNotes(){
  if(!currentSession||!currentPhase)return;
  const previous=currentSession.step_state?.[currentPhase.id],notes=Array.isArray(previous)?{}:{...(previous?.notes||{})};
  $$('[data-note-field]').forEach(input=>{const index=input.dataset.noteIndex;if(index===undefined)return;notes[index]={...(notes[index]||{}),[input.dataset.noteField]:input.type==='checkbox'?input.checked:input.value}});
  const checked=$$('#phase-questions [data-check]').filter(input=>input.checked).map(input=>Number(input.dataset.check));
  currentSession.step_state={...(currentSession.step_state||{}),[currentPhase.id]:{checked,notes}};scheduleProgressSave();
}
$('#hp-role').addEventListener('input',()=>{if(!currentSession)return;currentSession.context_data={...(currentSession.context_data||{}),hpRole:$('#hp-role').value};scheduleProgressSave();const role=$('#hp-role').value||'　　　　　　　　　　　　　　';$('#base-script').textContent=formatScriptText(currentPhase.base_script.replaceAll('〇〇様',`${currentSession.owner_name||'〇〇'}様`).replaceAll('{{hpRole}}',role))});
$('#session-notes').addEventListener('input',scheduleProgressSave);
$('#previous-step').addEventListener('click',()=>{const index=config.phases.findIndex(phase=>phase.id===currentPhase.id);if(index>0)selectPhase(config.phases[index-1].id)});
$('#return-step').addEventListener('click',()=>selectPhase($('#return-select').value));
$('#objection-button').addEventListener('click',()=>{
  const details=$('#objection-suggest');if(details)details.open=true;
  $('#assist-panel').classList.add('attention');
  requestAnimationFrame(()=>{$('#customer-statement').focus();$('#customer-statement').scrollIntoView({behavior:'smooth',block:'center'})});
});
$('#next-step').addEventListener('click',()=>{
  const index=config.phases.findIndex(phase=>phase.id===currentPhase.id);if(index<0||index===config.phases.length-1)return toast('最後のステップです。商談結果を保存してください。');
  // 確認事項UIは商談実行画面に表示しないため、未入力を理由に次へ進めなくすることはしない
  selectPhase(config.phases[index+1].id);
});
function gateRequirements(){
  const state=currentSession?.step_state||{};
  const checked=id=>Array.isArray(state[id])?state[id]:state[id]?.checked||[];
  return [
    ['HPに求める役割・用途を確認している',checked('hp_interest').includes(0)],
    ['制作品質について肯定が取れている',checked('hp_interest').includes(1)],
    ['費用がかからないなら喜ばれると確認できている',checked('hp_interest').includes(2)],
    ['ホームページを作りたいという仮合意が取れている',checked('hp_interest').includes(3)],
    ['決裁者を確認している',checked('agenda').includes(2)]
  ];
}
function gateComplete(){return gateRequirements().every(([,done])=>done)}
function openGate(){
  const missing=gateRequirements().filter(([,done])=>!done).map(([label])=>label);
  $('#missing-checks').innerHTML=`<b>未確認の項目</b><ul>${missing.map(item=>`<li>${item}</li>`).join('')}</ul>`;$('#gate-dialog').showModal();
}
$$('[data-gate-return]').forEach(button=>button.addEventListener('click',()=>{$('#gate-dialog').close();selectPhase(button.dataset.gateReturn)}));
$('#gate-cancel').addEventListener('click',()=>$('#gate-dialog').close());$('#gate-force').addEventListener('click',()=>{$('#gate-dialog').close();selectPhase('free_conditions');toast('確認のうえ④へ進みました')});
$('#suggest-button').addEventListener('click',async()=>{if(!currentSession){toast('先に商談を開始してください');show('deals');return}const button=$('#suggest-button');button.disabled=true;$('#suggest-status').textContent='正式スクリプトを確認中…';try{const data=await api('/api/sales/suggestions',{method:'POST',body:JSON.stringify({sessionId:currentSession.id,phaseId:currentPhase.id,objectionId:$('#objection-select').value,statement:$('#customer-statement').value})});currentSuggestion=data;$('#suggest-status').textContent=`${data.notice}｜根拠IDを記録`;$('#suggestions').innerHTML=data.candidates.map((item,index)=>`<article class="candidate"><header><span>${index+1}</span><b>${item.response_type}</b><small>${item.source_id}</small></header><p>${item.response_text}</p><div><small>次に聞く質問</small><p>${item.next_question}</p></div><button data-use="${index}">この返答を使用</button></article>`).join('')+(data.warnings.length?`<div class="inline-alert">入力に禁止表現が含まれています：${data.warnings.join('、')}</div>`:'');$$('[data-use]').forEach(el=>el.addEventListener('click',()=>useSuggestion(Number(el.dataset.use))))}catch(error){toast(error.message)}finally{button.disabled=false}});
async function loadSessionRecord(){
  if(!currentSession)return;const data=await api(`/api/sales/sessions/${currentSession.id}/record`);
  const labels={commitment:'言質・合意',proposed_products:'提案商材',acquired_products:'獲得商材',electricity:'電気',referral:'紹介案件',progress:'進捗',next_action:'次回アクション',log:'ログ',hp_purpose:'HP目的',hp_details:'HP詳細',decision_maker:'決裁者'};
  $('#live-facts').innerHTML=data.facts.length?data.facts.map(item=>`<article><span>${labels[item.category]||item.category}</span><p>${item.value}</p><small>${new Date(item.created_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</small></article>`).join(''):'<p class="muted small">記録はまだありません。</p>';
  $('#session-objections').innerHTML=data.objections.length?data.objections.map(item=>`<article><b>${item.customer_statement||'発言未入力'}</b><small>${item.detected_objection}｜${new Date(item.created_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</small></article>`).join(''):'<p class="muted small">アウトはまだありません。</p>';
}
// AI整理結果には商談メモ原文の引用が含まれうるため、innerHTMLへ入れる前に必ずエスケープする
function renderPredictedObjections(note){
  const items=note.predicted_objections||[],commitments=note.commitments||[],signals=note.objection_signals||[];
  $('#predicted-objections').innerHTML=`<section class="reaction-digest"><small>相手の反応</small><b>${escapeHtml(note.reaction_summary||'反応を追加確認')}</b>${commitments.length?`<div><small>取れた言質</small>${commitments.map(item=>`<p>✓ ${escapeHtml(item)}</p>`).join('')}</div>`:''}${signals.length?`<div><small>アウトの兆候</small>${signals.map(item=>`<p>・${escapeHtml(item)}</p>`).join('')}</div>`:''}</section>${items.length?`<div class="prediction-title"><b>次に来そうなアウト</b><small>${items.length}件を予測</small></div>${items.map(item=>`<article><span>${escapeHtml(item.category)}</span><b>${escapeHtml(item.subcategory)}</b><p>${escapeHtml(item.responseText)}</p><div><small>次に確認</small>${escapeHtml(item.nextQuestion)}</div></article>`).join('')}`:''}`;
}
async function loadTalkObjectionNotes(){
  if(!currentSession)return;const data=await api(`/api/sales/talk-scripts/${currentSession.talk_script_id}/objection-notes`);
  $('#talk-objection-notes').innerHTML=data.notes.length?data.notes.map(note=>`<article><small>${new Date(note.created_at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small><b>${escapeHtml(note.reaction_summary||'反応メモ')}</b><p>${escapeHtml(note.memo)}</p>${note.commitments?.length?`<div class="saved-commitments">${note.commitments.map(item=>`<em>言質：${escapeHtml(item)}</em>`).join('')}</div>`:''}<div>${note.predicted_objections.map(item=>`<span>${escapeHtml(item.category)}</span>`).join('')}</div></article>`).join(''):'<p class="muted small">保存されたメモはまだありません。</p>';
}
$('#save-scratch-analysis').addEventListener('click',async()=>{
  if(!currentSession)return toast('先に商談を開始してください');
  const button=$('#save-scratch-analysis');button.disabled=true;
  try{
    // 別入力欄を持たず、右側「商談メモ」の原文（未送信の下書き含む）をAI整理の入力元にする
    const data=await FsMeetingNote.commit();
    const memo=(data?.memos||[]).map(item=>item.content).join('\n').trim();
    if(!memo)return toast('商談メモを入力してください');
    const result=await api(`/api/sales/talk-scripts/${currentSession.talk_script_id}/objection-notes`,{method:'POST',body:JSON.stringify({sessionId:currentSession.id,phaseId:currentPhase?.id,memo,actor:currentSession.staff_id||'FS'})});
    renderPredictedObjections(result.note);await loadTalkObjectionNotes();toast('商談メモをAI整理して保存しました');
  }catch(error){toast(error.message)}finally{button.disabled=false}
});
$('#save-fact').addEventListener('click',async()=>{if(!currentSession)return toast('先に商談を開始してください');try{await api(`/api/sales/sessions/${currentSession.id}/facts`,{method:'POST',body:JSON.stringify({category:$('#fact-category').value,value:$('#fact-value').value})});$('#fact-value').value='';await loadSessionRecord();toast('商談記録へ追加しました')}catch(error){toast(error.message)}});
async function useSuggestion(index){await api(`/api/sales/suggestions/${currentSuggestion.id}/use`,{method:'POST',body:JSON.stringify({selectedCandidate:index})});$$('[data-use]').forEach((el,i)=>{el.textContent=i===index?'使用済み ✓':'この返答を使用';el.classList.toggle('used',i===index)});await loadSessionRecord();toast('使用した返答を記録しました')}

// ===== アウト即時相談：フェーズタイトル横の入力欄→承認済み/自動候補のpopup =====
function closeQuickObjectionPopup(){$('#quick-objection-popup').hidden=true}
async function runQuickObjectionConsult(offset){
  if(!currentSession)return toast('先に商談を開始してください');
  if(!currentPhase)return;
  const statement=$('#quick-objection-input').value.trim();
  if(!statement)return;
  if(quickObjectionBusy)return;
  quickObjectionBusy=true;
  const button=$('#quick-objection-form button[type=submit]');button.disabled=true;
  try{
    const data=await api('/api/sales/suggestions',{method:'POST',body:JSON.stringify({sessionId:currentSession.id,phaseId:currentPhase.id,statement,offset})});
    quickObjectionSuggestion=data;quickObjectionOffset=offset;
    $('#quick-objection-echo').textContent=statement;
    $('#quick-objection-notice').textContent=data.notice;
    $('#quick-objection-candidates').innerHTML=data.candidates.length
      ?data.candidates.map((item,index)=>`<article class="quick-objection-candidate"><header><span class="quick-objection-badge">${escapeHtml(item.badge)}</span></header><p>${escapeHtml(item.response_text)}</p><button type="button" data-quick-use="${index}">この返答を使う</button></article>`).join('')
      :'<p class="muted small">候補が見つかりませんでした。</p>';
    $$('#quick-objection-candidates [data-quick-use]').forEach(node=>node.addEventListener('click',()=>useQuickObjectionSuggestion(Number(node.dataset.quickUse))));
    $('#quick-objection-more').hidden=!data.hasMore;
    $('#quick-objection-popup').hidden=false;
  }catch(error){toast(error.message)}
  finally{quickObjectionBusy=false;button.disabled=false}
}
async function useQuickObjectionSuggestion(index){
  if(!quickObjectionSuggestion)return;
  await api(`/api/sales/suggestions/${quickObjectionSuggestion.id}/use`,{method:'POST',body:JSON.stringify({selectedCandidate:index})});
  $$('#quick-objection-candidates [data-quick-use]').forEach((node,i)=>{node.textContent=i===index?'使用済み ✓':'この返答を使う';node.classList.toggle('used',i===index)});
  await loadSessionRecord();
  toast('採用した返答を記録しました');
}
const quickObjectionInput=$('#quick-objection-input');
quickObjectionInput.addEventListener('compositionstart',()=>{quickObjectionComposing=true});
quickObjectionInput.addEventListener('compositionend',()=>{quickObjectionComposing=false});
quickObjectionInput.addEventListener('keydown',event=>{
  // IME変換中のEnterでは実行しない（変換確定のEnterと商談画面での誤送信を区別する）
  if(event.key==='Enter'&&(quickObjectionComposing||event.keyCode===229))event.preventDefault();
});
$('#quick-objection-form').addEventListener('submit',event=>{
  event.preventDefault();
  if(quickObjectionComposing)return;
  runQuickObjectionConsult(0);
});
$('#quick-objection-more').addEventListener('click',()=>runQuickObjectionConsult(quickObjectionOffset+3));
$('#quick-objection-close').addEventListener('click',closeQuickObjectionPopup);
$('#finish-button').addEventListener('click',async()=>{if(!currentSession){toast('進行中の商談がありません');return}$('#finish-dialog').showModal();await openFinishDialog()});$('#notes-button').addEventListener('click',()=>$('#finish-button').click());
// ===== 今回扱った商材・原文メモ・AI解析 =====
const MEETING_PRODUCTS=[
  {code:'enepal',label:'エネパル'},
  {code:'amex',label:'AMEX'},
  {code:'smbc_business_owners',label:'三井住友ビジネスオーナーズ'},
  {code:'acom_ac_mastercard',label:'アコム（ACマスターカード）'},
  {code:'none',label:'今回は商材提案なし'}
];
const NOTE_SOURCE_LABELS={during_meeting:'商談中',closing_form:'終了時追記',post_meeting:'商談後追記'};
const noteTime=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})};
function renderProductChecks(container,selected=[]){
  if(!container)return;
  container.textContent='';
  for(const item of MEETING_PRODUCTS){
    const input=el('input',{type:'checkbox',value:item.code});
    input.checked=selected.includes(item.code);
    // 「商材提案なし」は他商材と同時に選べない
    input.addEventListener('change',()=>{
      const boxes=[...container.querySelectorAll('input[type=checkbox]')];
      if(input.value==='none'&&input.checked)boxes.forEach(box=>{if(box!==input)box.checked=false});
      else if(input.checked)boxes.forEach(box=>{if(box.value==='none')box.checked=false});
    });
    const label=el('label',{class:'product-check'},[input,el('span',{text:item.label})]);
    container.append(label);
  }
}
const selectedFinishProducts=()=>[...$('#finish-products').querySelectorAll('input[type=checkbox]')].filter(box=>box.checked).map(box=>box.value);
// 原文メモはAI解析と混ぜず、そのまま時系列で見せる
function renderNoteList(container,notes,{onEdit,onDelete,onHistory}={}){
  if(!container)return;
  container.textContent='';
  if(!notes.length){container.append(el('p',{class:'muted small',text:'メモはまだありません。'}));return}
  for(const note of notes){
    const head=el('small',{class:'note-head',text:[noteTime(note.created_at),note.phase_id&&phaseLabelOf(note.phase_id),NOTE_SOURCE_LABELS[note.source]||note.source,note.author_id].filter(Boolean).join('｜')});
    const body=el('p',{class:'note-body',text:note.content});
    const actions=el('div',{class:'note-actions'});
    const add=(label,handler)=>{const button=el('button',{class:'secondary',type:'button',text:label});button.addEventListener('click',()=>handler(note));actions.append(button)};
    if(onEdit)add('編集',onEdit);
    if(onDelete)add('削除',onDelete);
    if(onHistory&&note.updated_at&&note.updated_at!==note.created_at)add('編集履歴',onHistory);
    container.append(el('article',{class:'note-item'},[head,body,actions.childElementCount?actions:null]));
  }
}
const ANALYSIS_STATUS_LABELS={pending:'未解析',completed:'最新',stale:'メモ更新後・要再解析',failed:'解析失敗'};
function renderAnalysis(statusNode,bodyNode,analysis){
  if(statusNode){
    statusNode.textContent='';
    const status=analysis?.status||'pending';
    statusNode.append(el('span',{class:`analysis-badge s-${status}`,text:ANALYSIS_STATUS_LABELS[status]||status}));
    if(analysis?.edited_text)statusNode.append(el('span',{class:'analysis-badge edited',text:'担当者修正済み'}));
    if(status==='stale')statusNode.append(el('span',{class:'analysis-note',text:'メモが更新されています。AI解析を更新してください。'}));
    if(status==='failed')statusNode.append(el('span',{class:'analysis-note',text:'AI解析を作成できませんでした。商談記録は保存されています。'}));
  }
  if(bodyNode){
    bodyNode.textContent='';
    const text=analysis?.edited_text||analysis?.generated_text||'';
    bodyNode.append(el('pre',{class:'analysis-text',text:text||'まだ解析していません。「AI解析を更新」を押してください。'}));
  }
}
async function loadFinishAnalysis(){
  if(!currentSession)return;
  try{
    const data=await api(`/api/fs/meetings/${encodeURIComponent(currentSession.id)}/analysis`);
    renderAnalysis($('#finish-analysis-status'),$('#finish-analysis-body'),data.analysis);
  }catch{renderAnalysis($('#finish-analysis-status'),$('#finish-analysis-body'),null)}
}
async function openFinishDialog(){
  if(!currentSession)return;
  try{
    const data=await api(`/api/fs/meetings/${encodeURIComponent(currentSession.id)}/notes`);
    renderProductChecks($('#finish-products'),data.products||[]);
    renderNoteList($('#finish-note-list'),data.notes||[]);
  }catch{renderProductChecks($('#finish-products'),[]);renderNoteList($('#finish-note-list'),[])}
  await loadFinishAnalysis();
}
$('#finish-run-analysis').addEventListener('click',async()=>{
  if(!currentSession)return;
  const button=$('#finish-run-analysis');button.disabled=true;
  try{
    const data=await api(`/api/fs/meetings/${encodeURIComponent(currentSession.id)}/analysis`,{method:'POST',body:JSON.stringify({actor:currentSession.staff_id||'FS'})});
    renderAnalysis($('#finish-analysis-status'),$('#finish-analysis-body'),data.analysis);
  }catch(error){toast(error.message)}finally{button.disabled=false}
});
$('#pause-button').addEventListener('click',async()=>{
  if(!currentSession)return toast('進行中の商談がありません');
  try{
    await saveProgress();await FsMeetingNote.flush();
    await api(`/api/fs/meetings/${encodeURIComponent(currentSession.id)}/interrupt`,{method:'POST',body:JSON.stringify({currentPhase:currentPhase?.id,actor:currentSession.staff_id||'FS'})});
    currentSession=null;storage.set(ACTIVE_MEETING_KEY,'');FsMeetingNote.close();
    toast('商談を中断しました。各種案件用から再開できます');
    await loadDeals();show('deals');
  }catch(error){toast(error.message)}
});
$('#finish-form').addEventListener('submit',async event=>{
  if(event.submitter?.value==='cancel')return;
  event.preventDefault();
  // currentTarget は await のあと null になるため、ここで保持する
  const form=event.currentTarget,body=Object.fromEntries(new FormData(form));
  if(!currentSession)return toast('進行中の商談がありません');
  // 商談結果は入力しない。今回扱った商材を送る。
  body.products=selectedFinishProducts();
  body.actor=currentSession.staff_id||'FS';
  const meetingId=currentSession.id;
  try{
    await FsMeetingNote.flush();
    await api(`/api/sales/sessions/${meetingId}/finish`,{method:'POST',body:JSON.stringify(body)});
    $('#finish-dialog').close();FsMeetingNote.clearDraft(meetingId);FsMeetingNote.close();
    currentSession=null;storage.set(ACTIVE_MEETING_KEY,'');form.reset();
    toast('商談結果を保存しました');show('results');await load();
  }catch(error){toast(error.message)}
});
const factValues=(facts,category)=>facts.filter(item=>item.category===category).map(item=>item.value).join('\n');
async function buildHandoffFormat(session,facts){
  const target=session||currentSession;
  if(!target)return '';
  const record=facts?{facts}:await api(`/api/sales/sessions/${target.id}/record`),form=session?{result:target.result,nextAction:target.next_action,nextActionDate:target.next_action_at,notes:target.notes}:Object.fromEntries(new FormData($('#finish-form'))),context=target.context_data||{};
  const proposed=factValues(record.facts,'proposed_products')||context.targetProducts||'';
  const acquired=factValues(record.facts,'acquired_products');
  const electricity=factValues(record.facts,'electricity');
  const referral=factValues(record.facts,'referral');
  const progress=factValues(record.facts,'progress')||form.result||'';
  const next=factValues(record.facts,'next_action')||form.nextAction||'';
  const logs=[factValues(record.facts,'log'),factValues(record.facts,'commitment'),target.notes,form.notes].filter(Boolean).join('\n');
  const hpPurpose=factValues(record.facts,'hp_purpose')||context.hpRole||'';
  const hpDetails=factValues(record.facts,'hp_details')||context.hookPoints||'';
  const nextDateValue=form.nextActionDate?new Date(String(form.nextActionDate).includes('T')?form.nextActionDate:`${form.nextActionDate}T00:00`):null;
  const nextDate=nextDateValue&&!Number.isNaN(nextDateValue.getTime())?nextDateValue.toLocaleDateString('ja-JP',{month:'numeric',day:'numeric'}):(next.match(/\d{1,2}\/\d{1,2}/)?.[0])||'';
  return `【HD：進捗管理シート引き継ぎFMT】
【案件名：${target.customer_name||''}】

＜提案商材＞
${proposed}

＜獲得商材＞
${acquired}

（電気）
${electricity}

＜紹介案件＞
${referral}

①進捗：${progress}
②次回アクション日：${nextDate}
③次回アクション内容：${next}
④ログ：${logs}

＜HPについて＞
作成目的：${hpPurpose}
具体的な内容：${hpDetails}`;
}
$('#preview-handoff').addEventListener('click',async()=>{if(!currentSession)return;$('#handoff-output').value=await buildHandoffFormat();$('#finish-dialog').close();$('#handoff-dialog').showModal()});
$('#close-handoff').addEventListener('click',()=>{$('#handoff-dialog').close();$('#finish-dialog').showModal()});
$('#copy-handoff').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#handoff-output').value);$('#copy-status').textContent='コピーしました';toast('引き継ぎFMTをコピーしました')}catch{$('#handoff-output').select();document.execCommand('copy');$('#copy-status').textContent='コピーしました'}});
$('#phase-form').addEventListener('submit',async event=>{event.preventDefault();const raw=Object.fromEntries(new FormData(event.currentTarget));const body={...raw,requiredQuestions:raw.requiredQuestions.split('\n').map(v=>v.trim()).filter(Boolean),prohibitedPhrases:raw.prohibitedPhrases.split('\n').map(v=>v.trim()).filter(Boolean),actor:'管理者'};const data=await api(`/api/sales/phases/${raw.id}`,{method:'PUT',body:JSON.stringify(body)});config.phases=config.phases.map(item=>item.id===data.phase.id?data.phase:item);renderPhases();editPhase(data.phase.id);selectPhase(currentPhase?.id||'intro');$('#admin-message').textContent=`保存しました（v${data.phase.version}）`;toast('公開スクリプトを更新しました')});
const messages=$('#messages'),chatForm=$('#chat'),input=$('#input'),send=$('#send');
function addMessage(role,text,links=[]){const article=document.createElement('article');article.className=`message ${role}`;if(role==='assistant'){const img=document.createElement('img');img.src='/assistant-icon.png';article.append(img)}const bubble=document.createElement('div');bubble.className='bubble';bubble.textContent=text;for(const link of links){bubble.append(document.createElement('br'));const a=document.createElement('a');a.href=link.url;a.target='_blank';a.rel='noreferrer';a.textContent=link.label;bubble.append(a)}article.append(bubble);messages.append(article);messages.scrollTop=messages.scrollHeight;return article}
async function ask(text){if(!text.trim())return;addMessage('user',text);input.value='';send.disabled=true;const loading=addMessage('assistant','確認しています…');try{const data=await api('/api/chat',{method:'POST',body:JSON.stringify({message:text})});loading.remove();addMessage('assistant',data.text||'応答がありません。',data.links||[])}catch(error){loading.remove();addMessage('assistant',error.message)}finally{send.disabled=false}}
chatForm.addEventListener('submit',event=>{event.preventDefault();ask(input.value)});document.addEventListener('click',event=>{const prompt=event.target.dataset?.prompt;if(prompt)ask(prompt)});
FsMeetingNote.mount({input:$('#meeting-memo-input'),list:$('#meeting-memo-list'),status:$('#memo-status'),request:api,phaseLabel:phaseLabelOf,historyDetails:$('#memo-history'),historyCount:$('#memo-history-count'),historyEmpty:$('#memo-history-empty')});
bindPreinfoAutoHide();
// 再読み込み後も、終了していない商談は同じ画面とメモの状態で復元する
async function restoreActiveMeeting(){
  const meetingId=storage.get(ACTIVE_MEETING_KEY);
  if(!meetingId)return;
  try{
    const detail=await api(`/api/fs/deals/${encodeURIComponent(meetingId)}`);
    if(!detail.session||detail.session.finished_at){storage.set(ACTIVE_MEETING_KEY,'');return}
    await enterSalesSession(detail.session);
    toast('進行中の商談とメモを復元しました');
  }catch{storage.set(ACTIVE_MEETING_KEY,'')}
}
load().then(restoreActiveMeeting).catch(error=>toast(error.message));

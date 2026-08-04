// 商談画面右側の殴り書きメモ。入力・自動保存・復元をMVPの最優先とする（要件 9章）。
const FsMeetingNote=(()=>{
  const AUTOSAVE_MS=4000;
  let input=null,list=null,status=null,request=null,phaseLabel=()=>'';
  let meetingId='',phaseId='',timer=null,dirty=false,saving=false;
  const draftKey=id=>`hdMemoDraft:${id}`;
  const localDraft=(id,value)=>{
    try{
      if(value===undefined)return localStorage.getItem(draftKey(id))||'';
      if(value)localStorage.setItem(draftKey(id),value); else localStorage.removeItem(draftKey(id));
    }catch{}
    return value||'';
  };
  const setStatus=text=>{if(status)status.textContent=text};
  const time=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})};
  function renderMemos(memos){
    if(!list)return;
    list.textContent='';
    if(!memos.length){
      const empty=document.createElement('p');empty.className='muted small';empty.textContent='メモはまだありません。気づいたことをそのまま入力してください。';
      list.append(empty);return;
    }
    for(const memo of [...memos].reverse()){
      const article=document.createElement('article');article.className='meeting-memo';
      const head=document.createElement('small');
      head.textContent=[time(memo.created_at),phaseLabel(memo.phase_id)].filter(Boolean).join('｜');
      const body=document.createElement('p');body.textContent=memo.content;
      article.append(head,body);list.append(article);
    }
  }
  async function saveDraft(force=false){
    if(!meetingId||!input||(!dirty&&!force)||saving)return;
    const content=input.value;saving=true;dirty=false;
    try{await request(`/api/fs/meetings/${encodeURIComponent(meetingId)}/memo-draft`,{method:'PUT',body:JSON.stringify({content})});setStatus(content?`自動保存しました ${time(new Date().toISOString())}`:'自動保存されます')}
    catch{dirty=true;setStatus('保存できませんでした。もう一度入力してください')}
    finally{saving=false}
  }
  function schedule(){
    clearTimeout(timer);
    timer=setTimeout(()=>saveDraft(),AUTOSAVE_MS);
  }
  async function addMemo(){
    const content=input.value.trim();
    if(!meetingId||!content)return;
    try{
      const data=await request(`/api/fs/meetings/${encodeURIComponent(meetingId)}/memos`,{method:'POST',body:JSON.stringify({phaseId,content})});
      input.value='';dirty=false;localDraft(meetingId,'');
      clearTimeout(timer);
      await saveDraft(true);
      setStatus(`メモを保存しました ${time(data.memo.created_at)}`);
      await reload();
    }catch(error){setStatus(error.message||'メモを保存できませんでした')}
  }
  async function reload(){
    if(!meetingId)return;
    const data=await request(`/api/fs/meetings/${encodeURIComponent(meetingId)}/memos`);
    renderMemos(data.memos||[]);
    return data;
  }
  return {
    mount(options){
      input=options.input;list=options.list;status=options.status;request=options.request;
      if(options.phaseLabel)phaseLabel=options.phaseLabel;
      if(!input)return;
      input.addEventListener('keydown',event=>{
        // 日本語変換確定中のEnterでは追加しない（要件 9.3）
        if(event.key!=='Enter'||event.shiftKey||event.isComposing||event.keyCode===229)return;
        event.preventDefault();addMemo();
      });
      input.addEventListener('input',()=>{dirty=true;localDraft(meetingId,input.value);setStatus('入力中…');schedule()});
      input.addEventListener('blur',()=>{clearTimeout(timer);saveDraft()});
      window.addEventListener('beforeunload',()=>{if(meetingId)localDraft(meetingId,input.value)});
    },
    async open(id,currentPhaseId){
      meetingId=id||'';phaseId=currentPhaseId||'';dirty=false;clearTimeout(timer);
      if(!input)return;
      input.value='';renderMemos([]);
      if(!meetingId){setStatus('商談を開始するとメモを保存できます');return}
      try{
        const data=await reload();
        const stored=localDraft(meetingId);
        input.value=stored||data?.memoDraft||'';
        setStatus(input.value?'前回の入力を復元しました':'自動保存されます');
      }catch(error){setStatus(error.message||'メモを読み込めませんでした')}
    },
    setPhase(id){
      if(id===phaseId)return;
      phaseId=id||'';
      clearTimeout(timer);saveDraft();
    },
    flush(){clearTimeout(timer);return saveDraft(true)},
    reload,
    close(){clearTimeout(timer);meetingId='';phaseId='';if(input)input.value='';renderMemos([]);setStatus('自動保存されます')},
    clearDraft(id){localDraft(id||meetingId,'')}
  };
})();
window.FsMeetingNote=FsMeetingNote;

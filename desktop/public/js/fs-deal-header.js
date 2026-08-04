// 商談画面上部の店舗情報ヘッダー。店舗名・オーナー名・IS備考・リンクは必ず textContent で挿入する。
const FS_SAFE_URL=value=>{
  const raw=String(value||'').trim();
  if(!raw)return '';
  try{const url=new URL(/^[a-z][\w+.-]*:/i.test(raw)?raw:`https://${raw}`);return url.protocol==='http:'||url.protocol==='https:'?url.href:''}catch{return ''}
};
const FS_MEETING_AT=value=>{
  const raw=String(value||'').trim();
  if(!raw)return '';
  const date=new Date(raw.length<=16&&raw.includes('T')?`${raw}:00`:raw);
  return Number.isNaN(date.getTime())?raw:date.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit'});
};
function fsMetaItem(label,value){
  const item=document.createElement('div');
  const small=document.createElement('small');small.textContent=label;
  const strong=document.createElement('b');strong.textContent=value;
  item.append(small,strong);
  return item;
}
function fsLinkButton(label,url){
  const link=document.createElement('a');
  link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.className='deal-link';
  link.textContent=label;
  return link;
}
// 入力があるものだけ表示する（要件 7.3 / 7.5）
function renderFsDealHeader(targets,deal){
  const data=deal||{};
  if(targets.owner)targets.owner.textContent=data.ownerName?`${data.ownerName}様`:'';
  if(targets.meta){
    targets.meta.textContent='';
    const rows=[['商談日時',FS_MEETING_AT(data.meetingAt)],['IS担当',data.isPerson],['商談担当',data.staffId],['対象商材',data.products],['決裁者',data.decisionMaker],['住所',data.address],['ステータス',data.status]];
    for(const [label,value] of rows)if(String(value||'').trim())targets.meta.append(fsMetaItem(label,String(value).trim()));
  }
  if(targets.links){
    targets.links.textContent='';
    const links=[['公式HP',data.websiteUrl],['Instagram',data.instagramUrl],['Googleマップ',data.googleMapsUrl]]
      .concat((Array.isArray(data.otherLinks)?data.otherLinks:[]).map(item=>[item?.label||'参考リンク',item?.url]));
    for(const [label,value] of links){const url=FS_SAFE_URL(value);if(url)targets.links.append(fsLinkButton(label,url))}
    targets.links.hidden=!targets.links.childElementCount;
  }
  if(targets.notes){
    targets.notes.textContent='';
    const notes=String(data.isNotes||'').trim()||String(data.handoff||'').trim();
    const label=document.createElement('small');label.textContent='IS備考';
    const body=document.createElement('p');body.className='deal-notes-body clamped';body.textContent=notes||'IS時点の備考は登録されていません。';
    targets.notes.append(label,body);
    if(notes.length>90||notes.split('\n').length>3){
      const toggle=document.createElement('button');
      toggle.type='button';toggle.className='deal-notes-toggle';toggle.textContent='全文を見る';
      toggle.addEventListener('click',()=>{
        const clamped=body.classList.toggle('clamped');
        toggle.textContent=clamped?'全文を見る':'折りたたむ';
      });
      targets.notes.append(toggle);
    }
  }
}
window.FsDealHeader={render:renderFsDealHeader,safeUrl:FS_SAFE_URL,formatMeetingAt:FS_MEETING_AT};

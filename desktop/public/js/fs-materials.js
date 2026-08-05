// 商談資料。タイトル・説明・URLはすべて textContent / setAttribute で扱い、innerHTML を使わない。
const FS_MATERIAL_LABELS={
  category:{talk:'トーク中に使用',hp_company:'HP・会社紹介',electricity:'電気・エネパル',contract:'申込書・契約',card_application:'カード申込',affiliate:'アフィリエイトリンク',other:'その他'},
  product:{common:'共通',hp:'HP制作',enepal:'エネパル',amex:'AMEX',smbc_business_owners:'三井住友ビジネスオーナーズ',ac_mastercard:'ACマスターカード'},
  sourceType:{google_slides:'Google Slides',powerpoint:'PowerPoint',google_sheets:'Google Sheets',google_docs:'Google Docs',pdf:'PDF',website:'Webページ',other:'その他'},
  visibility:{customer_shareable:'顧客共有可',fs_internal:'FS社内のみ',admin_only:'管理者のみ'}
};
const fsMaterialUrl=value=>{
  const raw=String(value||'').trim();
  if(!raw)return '';
  try{const url=new URL(raw);return url.protocol==='https:'?url.href:''}catch{return ''}
};
function fsMaterialNode(tag,props={},children=[]){
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(props)){
    if(key==='class')node.className=value;
    else if(key==='text')node.textContent=value;
    else if(value!==undefined&&value!==null&&value!==false)node.setAttribute(key,value===true?'':value);
  }
  for(const child of [].concat(children))if(child)node.append(child);
  return node;
}
// 資料は必ず新しいタブで開き、商談画面を遷移させない
function fsMaterialLink(material,label){
  const url=fsMaterialUrl(material.url);
  if(!url)return fsMaterialNode('span',{class:'material-missing',text:'リンク未登録'});
  const link=fsMaterialNode('a',{class:'material-open',href:url,target:'_blank',rel:'noopener noreferrer'});
  link.textContent=label||material.title;
  link.title=`${material.title}（新しいタブで開きます）`;
  return link;
}
function fsMaterialCard(material,{onCopy,onEdit,onToggle}={}){
  const head=fsMaterialNode('div',{class:'material-card-head'},[
    fsMaterialNode('span',{class:`material-visibility v-${material.visibility}`,text:FS_MATERIAL_LABELS.visibility[material.visibility]||material.visibility}),
    fsMaterialNode('h3',{text:material.title}),
    fsMaterialNode('p',{text:material.description||'（説明未登録）'})
  ]);
  const meta=fsMaterialNode('div',{class:'material-meta'},[
    fsMaterialNode('span',{text:FS_MATERIAL_LABELS.category[material.category]||material.category}),
    fsMaterialNode('span',{text:FS_MATERIAL_LABELS.product[material.product]||material.product}),
    fsMaterialNode('span',{text:FS_MATERIAL_LABELS.sourceType[material.sourceType]||material.sourceType}),
    material.updatedAt?fsMaterialNode('span',{text:`更新 ${String(material.updatedAt).slice(0,10)}`}):null,
    material.active?null:fsMaterialNode('span',{class:'material-stopped',text:'停止中'})
  ]);
  const actions=fsMaterialNode('div',{class:'material-actions'},[fsMaterialLink(material,'開く')]);
  // 社内資料のURLは画面に出さず、コピー操作のときだけクリップボードへ渡す
  if(material.visibility!=='customer_shareable'&&onCopy){
    const copy=fsMaterialNode('button',{class:'secondary',type:'button',text:'リンクをコピー'});
    copy.addEventListener('click',()=>onCopy(material,copy));
    actions.append(copy);
  }
  if(onEdit){const edit=fsMaterialNode('button',{class:'secondary',type:'button',text:'編集'});edit.addEventListener('click',()=>onEdit(material));actions.append(edit)}
  if(onToggle){const toggle=fsMaterialNode('button',{class:'secondary',type:'button',text:material.active?'停止する':'再開する'});toggle.addEventListener('click',()=>onToggle(material));actions.append(toggle)}
  return fsMaterialNode('article',{class:`material-card${material.active?'':' stopped'}`},[head,meta,actions]);
}
// 店舗情報ヘッダー直下の資料バー。最大4件で、右側メモ欄は圧迫しない。
function renderFsMaterialBar(container,materials,{onOpenAll,onOpen,message}={}){
  if(!container)return;
  container.textContent='';
  const label=fsMaterialNode('span',{class:'material-bar-label',text:'このフェーズで使う資料'});
  const list=fsMaterialNode('div',{class:'material-bar-list'});
  for(const material of materials){
    const url=fsMaterialUrl(material.url);
    if(!url)continue;
    const link=fsMaterialLink(material,material.title);
    link.classList.add('material-chip');
    link.dataset.materialId=material.id;
    if(material.visibility!=='customer_shareable')link.classList.add('internal');
    if(onOpen)link.addEventListener('click',()=>onOpen(material));
    list.append(link);
  }
  if(!materials.length)list.append(fsMaterialNode('span',{class:'material-bar-empty',text:message||'このフェーズに紐づく資料はありません'}));
  const all=fsMaterialNode('button',{class:'material-bar-all',type:'button',text:'全資料を見る'});
  if(onOpenAll)all.addEventListener('click',onOpenAll);
  container.append(label,list,all);
}
function renderFsMaterialList(container,materials,handlers={}){
  if(!container)return;
  container.textContent='';
  if(!materials.length){container.append(fsMaterialNode('p',{class:'muted small',text:'該当する資料はありません。'}));return}
  for(const material of materials)container.append(fsMaterialCard(material,handlers));
}
window.FsMaterials={
  labels:FS_MATERIAL_LABELS,
  safeUrl:fsMaterialUrl,
  card:fsMaterialCard,
  renderBar:renderFsMaterialBar,
  renderList:renderFsMaterialList
};

// FS個人画面のサイドバー。表示順は要件どおり固定し、旧メニューはここに含めない。
const FS_MENU=[
  {view:'templates',icon:'▤',label:'トークスクリプトテンプレ'},
  {view:'preparation',icon:'✎',label:'商談準備'},
  {view:'deals',icon:'▦',label:'各種案件用'},
  {view:'results',icon:'✓',label:'各種案件結果と振り返り'}
];
// 商談画面など、サイドバーに項目を持たない画面の選択中表示
const FS_VIEW_MENU={assist:'deals'};
function renderFsSidebar(container){
  if(!container)return;
  container.textContent='';
  for(const item of FS_MENU){
    const button=document.createElement('button');
    button.type='button';button.dataset.view=item.view;button.title=item.label;
    const icon=document.createElement('span');icon.textContent=item.icon;
    button.append(icon,document.createTextNode(item.label));
    container.append(button);
  }
  const toggle=document.createElement('button');
  toggle.type='button';toggle.className='sidebar-toggle';toggle.title='サイドバーを折りたたむ';
  const toggleIcon=document.createElement('span');toggleIcon.textContent='⇤';
  toggle.append(toggleIcon,document.createTextNode('折りたたむ'));
  toggle.addEventListener('click',()=>{
    const collapsed=document.body.classList.toggle('sidebar-collapsed');
    toggleIcon.textContent=collapsed?'⇥':'⇤';
    toggle.lastChild.textContent=collapsed?'開く':'折りたたむ';
    try{localStorage.setItem('hdSidebarCollapsed',collapsed?'1':'')}catch{}
  });
  container.append(toggle);
  try{if(localStorage.getItem('hdSidebarCollapsed'))toggle.click()}catch{}
}
function markFsSidebar(view){
  const active=FS_VIEW_MENU[view]||view;
  for(const button of document.querySelectorAll('#fs-sidebar button[data-view]'))button.classList.toggle('active',button.dataset.view===active);
}
window.FsSidebar={menu:FS_MENU,render:renderFsSidebar,mark:markFsSidebar};

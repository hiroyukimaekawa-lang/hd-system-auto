import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MAEKAWA_PHASES } from './maekawa-sales-script.js';
import { fileURLToPath } from 'node:url';

const now = () => new Date().toISOString();
const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const catalogFiles = directory => fs.readdirSync(directory).filter(file => file.endsWith('.json')).map(file => readJson(path.join(directory,file)));
export function loadSalesCatalog(root = moduleRoot) {
  const base = path.join(root,'config','sales-assist');
  const departments = catalogFiles(path.join(base,'departments'));
  const scriptRoot = path.join(base,'talk-scripts');
  const scripts = fs.readdirSync(scriptRoot).flatMap(department => catalogFiles(path.join(scriptRoot,department)));
  const applicationGuide = readJson(path.join(base,'application-guide.json'));
  return { departments, scripts, applicationGuide };
}
const parse = (value, fallback = []) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

export const safeUrl = value => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const candidate = /^[a-z][\w+.-]*:/i.test(raw) ? raw : /^[\w-]+(\.[\w-]+)+(\/|$)/.test(raw) ? `https://${raw}` : raw;
  try { const url = new URL(candidate); return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
};
const otherLinkList = data => {
  const raw = Array.isArray(data.otherLinks) ? data.otherLinks : String(data.otherLinks || '').split('\n');
  const extra = [{ label:'その他SNS', url:data.snsUrl }, { label:'参考資料', url:data.referenceUrl }];
  return [...raw.map(item => typeof item === 'string' ? { label:'参考リンク', url:item } : { label:item?.label || '参考リンク', url:item?.url }), ...extra]
    .map(item => ({ label:String(item.label || '参考リンク').trim() || '参考リンク', url:safeUrl(item.url) }))
    .filter(item => item.url)
    .filter((item, index, list) => list.findIndex(value => value.url === item.url) === index);
};
const CONTEXT_TEXT_KEYS = ['gbp','portalSite','social','decisionMaker','meetingAt','otherNotes','appointmentPattern','temperature','temperatureReason','issues','hookPoints','address','storePhone','mobile','targetProducts','talkDetails','isPerson','isNotes','appointmentBackground'];
export function buildContext(data = {}) {
  const context = Object.fromEntries(CONTEXT_TEXT_KEYS.map(key => [key, String(data[key] ?? '')]));
  context.websiteUrl = safeUrl(data.websiteUrl);
  context.instagramUrl = safeUrl(data.instagramUrl);
  context.googleMapsUrl = safeUrl(data.googleMapsUrl);
  context.snsUrl = safeUrl(data.snsUrl);
  context.referenceUrl = safeUrl(data.referenceUrl);
  context.otherLinks = otherLinkList(data);
  return context;
}

const FINISHED_WAITING = ['再商談','保留','明細を後日準備','共同経営者・家族へ確認','条件比較のみ実施'];
const FINISHED_LOST = ['失注','見送り'];
export function dealStatus({ preparationStatus, session, meetingAt }) {
  if (preparationStatus === 'cancelled') return 'キャンセル';
  if (!session) return meetingAt ? '商談予定' : '商談準備中';
  if (session.finished_at) {
    if (FINISHED_LOST.includes(session.result)) return '失注';
    if (FINISHED_WAITING.includes(session.result)) return '次回対応待ち';
    return '商談完了';
  }
  return session.interrupted_at ? '商談中断' : '商談中';
}

const LEGACY_PHASES = [
  { id:'intro', order:1, name:'導入', goal:'商談内容を理解してもらい、無料HP制作の話を聞く状態を作る', script:'本日は、お店の公式ホームページ制作についてご案内します。まず現在の情報発信や集客について、少しだけ状況を伺ってもよろしいでしょうか。', questions:['現在、公式ホームページはありますか？','InstagramやGoogleマップはどのように活用されていますか？'], transition:'現状の情報発信について話せる状態になったら次へ', prohibited:['電気を変えなくてもHPは無料','必ず集客できます'] },
  { id:'discovery', order:2, name:'現状確認', goal:'店舗の課題とHPを作る目的を把握する', script:'現在の集客・採用・情報更新で、特に困っていることを教えてください。既存サイトがある場合は、管理費や更新方法も確認します。', questions:['集客と採用では、どちらの優先度が高いですか？','営業時間やメニューの更新で困ることはありますか？'], transition:'課題とHPの目的を1つ以上確認できたら次へ', prohibited:['絶対に売上が上がる','必ず応募が増える'] },
  { id:'hp_proposal', order:3, name:'HP提案', goal:'確認した課題に合うHPの価値を具体化する', script:'伺った内容ですと、公式情報を一か所に整理し、GoogleやSNSから迷わず予約・問い合わせへ進める形が合いそうです。お店に合う構成をご一緒に確認します。', questions:['最も見てほしい情報は何ですか？','予約や問い合わせはどこへ集約したいですか？'], transition:'HPで解決する課題と掲載内容に合意できたら次へ', prohibited:['確実に検索順位が上がる','必ず予約が増える'] },
  { id:'mechanism', order:4, name:'無料の仕組み', goal:'HP制作と電気提案の関係を誤解なく説明する', script:'制作費の支援は提携企業との取り組みによるもので、電気契約の条件確認とご提案が前提です。HPだけを無条件で無料提供する仕組みではありません。', questions:['仕組みについて不明な点はありますか？','電気契約の状況を確認してもよろしいですか？'], transition:'無料条件への理解を確認できたら次へ', prohibited:['電気を変えなくてもHPは無料','完全無料です','無条件で無料です'] },
  { id:'electricity', order:5, name:'電気契約確認', goal:'現契約と比較に必要な条件を確認する', script:'正確に比較するため、現在の電力会社・契約名義・契約期間・違約金の有無を確認します。料金は明細を確認してからご案内します。', questions:['現在の電力会社と契約名義を教えていただけますか？','直近の明細を後日でも確認できますか？'], transition:'比較に必要な情報または後日確認の約束が取れたら次へ', prohibited:['絶対に安くなる','必ず切り替えられる','料金は確実に下がる'] },
  { id:'comparison', order:6, name:'条件比較・提案', goal:'確認済みの事実に基づき条件と手続きを説明する', script:'確認できた現在の条件と提案条件を並べて、料金だけでなく契約期間・違約金・手続き・サポートもご説明します。未確定事項は確認後に回答します。', questions:['料金以外に重視する条件はありますか？','切り替え判断に必要な確認事項は何ですか？'], transition:'比較結果への理解と次の行動を確認できたら次へ', prohibited:['必ず安くなる','デメリットはありません'] },
  { id:'objection', order:7, name:'アウト対応', goal:'断りの理由を分類し、無理に押さず次の確認へ戻す', script:'ご懸念の点を正しく理解したいので、理由を一つだけ確認させてください。確認できた正式情報の範囲でお答えします。', questions:['一番気になっている点はどこですか？','条件が確認できれば再検討できますか？'], transition:'理由を確認し、適切な元フェーズへ戻る', prohibited:['絶対に大丈夫','皆さん切り替えています'] },
  { id:'closing', order:8, name:'クロージング', goal:'商談結果と次の行動を双方で明確にする', script:'本日の確認事項を整理します。次は明細確認・関係者確認・再商談のいずれに進むか、時期も含めて決めましょう。', questions:['次に進めるために必要なものは何ですか？','次回の確認日はいつがよいですか？'], transition:'結果と次回行動を記録して終了', prohibited:['今日決めないと損です'] }
];
export const DEFAULT_PHASES = MAEKAWA_PHASES;

export const DEFAULT_OBJECTIONS = [
  ['hp_unneeded','HP不要','必要性を感じていない','hp_impression'],
  ['existing_hp','既存HPあり','既存サイトがある','hp_impression'],
  ['sns_enough','SNSで十分','SNSだけで足りている','hp_impression'],
  ['free_distrust','無料への不信','無料の理由が怪しい','free_conditions'],
  ['electricity_satisfied','電気切り替え拒否','現在の電力会社に満足','free_conditions'],
  ['electricity_past_rise','電気切り替え拒否','過去に料金が上がった','free_conditions'],
  ['electricity_relationship','電気切り替え拒否','知人・取引先との関係','free_conditions'],
  ['electricity_hassle','電気切り替え拒否','手続きが面倒','free_conditions'],
  ['electricity_quality','電気切り替え拒否','停電や品質が不安','free_conditions'],
  ['electricity_penalty','契約期間・違約金','契約期間・違約金がある','free_conditions'],
  ['decision_maker','決裁者不在','共同経営者・家族への確認が必要','agenda'],
  ['no_time','時間がない','今は話す時間がない','agenda'],
  ['compare','比較検討したい','他社や現契約と比較したい','free_conditions'],
  ['sales_rejection','営業への拒否感','営業の話なら断りたい','agenda'],
  ['other','その他','登録分類に当てはまらない','test_closing']
].map(([id,category,subcategory,phaseId]) => ({ id, category, subcategory, phaseId }));

const responseMap = {
  hp_unneeded:['承知しました。まず、HPを増やすこと自体ではなく、今の情報発信で困っている点がないかだけ確認させてください。','不要と感じる一番の理由は、更新の手間・費用・集客効果のどれに近いでしょうか。','SNSやGoogleから予約までの導線に課題がなければ、無理におすすめしません。現状を確認したうえで必要性を一緒に判断します。'],
  existing_hp:['既存サイトを活かせる可能性もあります。現在の管理費や更新のしやすさを確認して、作り直す必要があるかから判断します。','今のHPで、更新・費用・予約導線のうち困っている点はありますか？','新規制作だけでなく、公式情報の整理や運用費の見直しとして比較できます。現状に問題がなければ、その旨を正直にお伝えします。'],
  sns_enough:['SNSが機能しているのは大切です。そのうえで、営業時間や採用情報など公式情報の置き場所に困っていないか確認させてください。','SNSから予約や問い合わせまで、迷わず進める状態になっていますか？','SNSを置き換えるのではなく、SNSの受け皿として公式情報をまとめる考え方です。必要性がある部分だけご提案します。'],
  free_distrust:['ご不安はもっともです。制作費の支援は電気契約の条件確認と提案が前提で、HPだけを無条件で無料提供するものではありません。','仕組み・契約条件・追加費用のうち、どの点が一番気になりますか？','曖昧なまま進めず、条件と負担を順番に確認します。登録された正式情報で確認できない点は、持ち帰って回答します。'],
  electricity_relationship:['お付き合いがある契約を無理に変えるご提案はしません。まず関係性と契約条件を確認し、比較してよい状況かを判断します。','契約相手との関係は、知人・取引先・物件指定のどれに近いですか？','関係性を優先したうえで、契約期間や料金への不満があるかだけ整理できます。比較自体が難しければ、その前提で進めます。'],
  electricity_past_rise:['過去のご経験があれば慎重になるのは当然です。今回は明細と契約条件を確認し、未確定の段階で安くなるとは申し上げません。','以前は、単価・市場連動・契約条件のどこが変わって上がったか分かりますか？','過去の原因を切り分けたうえで、同じリスクがないか確認します。正式な比較結果が出るまでは判断をお願いしません。'],
  electricity_hassle:['手続きの負担が気になる点、承知しました。必要な作業と当社が支援できる範囲を、契約前に明確にします。','特に面倒に感じるのは、明細準備・申込・切り替え後の対応のどれですか？','負担になる工程を確認し、支援可能な範囲だけをご案内します。提供できない支援はお約束しません。'],
  electricity_quality:['停電や品質へのご不安ですね。供給条件は契約内容を確認し、正式情報に基づいてご説明します。','特に停電、復旧対応、問い合わせ窓口のどれが気になりますか？','現在登録されている正式情報だけでは個別条件を断定できません。条件を確認してから回答します。'],
  electricity_penalty:['違約金や契約期間がある場合は、先に確認が必要です。費用を無視して切り替えをおすすめすることはありません。','契約更新月や違約金の記載を明細・契約書で確認できますか？','更新時期を踏まえて比較する方法もあります。確認前に切り替え可能とは断定しません。'],
  electricity_satisfied:['現在の契約に満足されている点、承知しました。無理な変更はおすすめしません。','満足されているのは、料金・対応・付き合いのどの点でしょうか？','現状の良い条件を維持できるかを基準に比較します。メリットが確認できなければ、その結果をそのままお伝えします。'],
  decision_maker:['関係者の確認が必要ですね。本日の要点を短く整理し、確認いただく条件を明確にします。','どなたの確認が必要で、料金・契約・HPのどの資料があると判断しやすいですか？','次回は決裁に必要な方と情報を揃えて比較できます。まず確認期限と次回日程を決めましょう。'],
  no_time:['お忙しいところ失礼しました。今ここで無理に続けず、要点だけお伝えして改めます。','何曜日・何時ごろなら、短時間お話ししやすいですか？','次回は現状確認に必要な点だけに絞ります。ご都合のよい日時を優先します。'],
  compare:['比較して判断いただくのが適切です。料金だけでなく契約期間・違約金・支援範囲を同じ条件で並べます。','比較で最も重視する条件は何ですか？','判断材料が不足したまま結論を急ぎません。必要な資料と回答期限を整理します。'],
  sales_rejection:['営業へのご懸念、承知しました。不要であれば無理に進めません。内容を誤解なく判断いただくため、要点だけお伝えしてもよろしいですか。','営業全般が不要なのか、HPや電気の内容が対象外なのか、どちらに近いですか？','必要性がない場合はここで終了します。確認したい点がある場合だけ、正式情報の範囲で短く回答します。']
};

export class SalesAssistStore {
  constructor(file = 'state/sales-assist.sqlite') {
    fs.mkdirSync(path.dirname(file), { recursive:true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sales_phases(id TEXT PRIMARY KEY, phase_order INTEGER, group_name TEXT DEFAULT '', name TEXT, goal TEXT, base_script TEXT, required_questions TEXT, transition_conditions TEXT, prohibited_phrases TEXT, version INTEGER DEFAULT 1, status TEXT DEFAULT 'published', updated_at TEXT);
      CREATE TABLE IF NOT EXISTS objections(id TEXT PRIMARY KEY, category TEXT, subcategory TEXT, description TEXT, applicable_phase TEXT, status TEXT DEFAULT 'published', updated_at TEXT);
      CREATE TABLE IF NOT EXISTS objection_responses(id TEXT PRIMARY KEY, objection_id TEXT, response_type TEXT, response_text TEXT, next_question TEXT, return_phase TEXT, source_id TEXT, status TEXT DEFAULT 'published', version INTEGER DEFAULT 1, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS sales_sessions(id TEXT PRIMARY KEY, staff_id TEXT, customer_name TEXT, business_type TEXT, owner_name TEXT, meeting_type TEXT, product_id TEXT, existing_hp TEXT, electricity_company TEXT, handoff TEXT, concerns TEXT, current_phase TEXT, context_data TEXT DEFAULT '{}', step_state TEXT DEFAULT '{}', notes TEXT DEFAULT '', result TEXT, next_action TEXT, started_at TEXT, finished_at TEXT);
      CREATE TABLE IF NOT EXISTS ai_suggestions(id TEXT PRIMARY KEY, session_id TEXT, phase_id TEXT, customer_statement TEXT, detected_objection TEXT, generated_candidates TEXT, selected_candidate INTEGER, used INTEGER DEFAULT 0, created_at TEXT);
      CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT, entity_type TEXT, entity_id TEXT, detail TEXT, created_at TEXT);
      CREATE TABLE IF NOT EXISTS sales_meta(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS departments(id TEXT PRIMARY KEY, name TEXT, description TEXT, status TEXT, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS talk_scripts(id TEXT PRIMARY KEY, department_id TEXT, name TEXT, products TEXT, customer_type TEXT, version TEXT, status TEXT, updated_at TEXT, phase_count INTEGER DEFAULT 0, use_count INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS talk_script_phases(id TEXT PRIMARY KEY, talk_script_id TEXT, phase_order INTEGER, group_name TEXT, name TEXT, goal TEXT, base_script TEXT, required_questions TEXT, transition_conditions TEXT, prohibited_phrases TEXT, version INTEGER DEFAULT 1, status TEXT DEFAULT 'published', updated_at TEXT);
      CREATE TABLE IF NOT EXISTS sales_preparations(id TEXT PRIMARY KEY, department_id TEXT, talk_script_id TEXT, talk_script_version TEXT, staff_id TEXT, customer_name TEXT, business_type TEXT, owner_name TEXT, meeting_type TEXT, existing_hp TEXT, electricity_company TEXT, handoff TEXT, concerns TEXT, context_data TEXT DEFAULT '{}', next_action TEXT DEFAULT '', next_action_at TEXT DEFAULT '', status TEXT DEFAULT 'prepared', created_at TEXT, updated_at TEXT, opened_at TEXT, session_id TEXT);
      CREATE TABLE IF NOT EXISTS sales_facts(id TEXT PRIMARY KEY, session_id TEXT, category TEXT, value TEXT, source TEXT DEFAULT 'fs_input', created_at TEXT);
      CREATE TABLE IF NOT EXISTS talk_script_objection_notes(id TEXT PRIMARY KEY, talk_script_id TEXT, session_id TEXT, phase_id TEXT, memo TEXT, predicted_objections TEXT DEFAULT '[]', created_at TEXT);
      CREATE TABLE IF NOT EXISTS meeting_memos(id TEXT PRIMARY KEY, meeting_id TEXT, phase_id TEXT DEFAULT '', content TEXT, created_at TEXT);
      CREATE INDEX IF NOT EXISTS meeting_memos_meeting ON meeting_memos(meeting_id, created_at);
    `);
    this.ensureColumn('sales_phases','group_name',"TEXT DEFAULT ''");
    this.ensureColumn('sales_sessions','context_data',"TEXT DEFAULT '{}'");
    this.ensureColumn('sales_sessions','step_state',"TEXT DEFAULT '{}'");
    this.ensureColumn('sales_sessions','department_id',"TEXT DEFAULT 'hd'");
    this.ensureColumn('sales_sessions','talk_script_id',"TEXT DEFAULT 'hd-new-ap-20260725'");
    this.ensureColumn('sales_sessions','talk_script_version',"TEXT DEFAULT '2026/07/25'");
    this.ensureColumn('sales_sessions','next_action_at',"TEXT DEFAULT ''");
    this.ensureColumn('sales_preparations','next_action',"TEXT DEFAULT ''");
    this.ensureColumn('sales_preparations','next_action_at',"TEXT DEFAULT ''");
    this.ensureColumn('talk_scripts','title_customized',"INTEGER DEFAULT 0");
    this.ensureColumn('talk_scripts','local_created',"INTEGER DEFAULT 0");
    this.ensureColumn('sales_sessions','deal_id',"TEXT DEFAULT ''");
    this.ensureColumn('sales_sessions','memo_draft',"TEXT DEFAULT ''");
    this.ensureColumn('sales_sessions','interrupted_at',"TEXT DEFAULT ''");
    this.ensureColumn('sales_sessions','forecast',"TEXT DEFAULT ''");
    this.ensureColumn('sales_sessions','reflection',"TEXT DEFAULT ''");
    this.ensureColumn('sales_preparations','deal_id',"TEXT DEFAULT ''");
    this.ensureColumn('talk_script_objection_notes','reaction_summary',"TEXT DEFAULT ''");
    this.ensureColumn('talk_script_objection_notes','commitments',"TEXT DEFAULT '[]'");
    this.ensureColumn('talk_script_objection_notes','objection_signals',"TEXT DEFAULT '[]'");
    this.seed();
  }
  ensureColumn(table,column,type) {
    if (!this.db.prepare(`PRAGMA table_info(${table})`).all().some(item => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  seed() {
    const contentVersion = 3;
    const storedVersion = Number(this.db.prepare("SELECT value FROM sales_meta WHERE key='script_content_version'").get()?.value || 0);
    const phase = this.db.prepare(`INSERT INTO sales_phases(id,phase_order,group_name,name,goal,base_script,required_questions,transition_conditions,prohibited_phrases,version,status,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET phase_order=excluded.phase_order,group_name=excluded.group_name,name=excluded.name,goal=excluded.goal,base_script=excluded.base_script,required_questions=excluded.required_questions,transition_conditions=excluded.transition_conditions,prohibited_phrases=excluded.prohibited_phrases,version=excluded.version,status=excluded.status,updated_at=excluded.updated_at`);
    const objection = this.db.prepare('INSERT OR IGNORE INTO objections(id,category,subcategory,description,applicable_phase,updated_at) VALUES(?,?,?,?,?,?)');
    const response = this.db.prepare('INSERT OR IGNORE INTO objection_responses(id,objection_id,response_type,response_text,next_question,return_phase,source_id,updated_at) VALUES(?,?,?,?,?,?,?,?)');
    const run = this.db.transaction(() => {
      if (storedVersion < contentVersion) {
        this.db.prepare('DELETE FROM sales_phases').run();
        for (const item of DEFAULT_PHASES) phase.run(item.id,item.order,item.group,item.name,item.goal,item.script,JSON.stringify(item.questions),item.transition,JSON.stringify(item.prohibited),1,'published',now());
        this.db.prepare("INSERT INTO sales_meta(key,value) VALUES('script_content_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(contentVersion));
      }
      const catalog = loadSalesCatalog();
      const catalogScriptIds = catalog.scripts.map(item=>item.id);
      if (catalogScriptIds.length) this.db.prepare(`DELETE FROM talk_scripts WHERE local_created=0 AND id NOT IN (${catalogScriptIds.map(()=>'?').join(',')})`).run(...catalogScriptIds);
      const departmentInsert = this.db.prepare('INSERT INTO departments(id,name,description,status,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,status=excluded.status,updated_at=excluded.updated_at');
      const scriptInsert = this.db.prepare('INSERT INTO talk_scripts(id,department_id,name,products,customer_type,version,status,updated_at,phase_count) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET department_id=excluded.department_id,name=CASE WHEN talk_scripts.title_customized=1 THEN talk_scripts.name ELSE excluded.name END,products=excluded.products,customer_type=excluded.customer_type,version=excluded.version,status=excluded.status,updated_at=CASE WHEN talk_scripts.title_customized=1 THEN talk_scripts.updated_at ELSE excluded.updated_at END,phase_count=excluded.phase_count');
      for (const item of catalog.departments) departmentInsert.run(item.id,item.name,item.description,item.status,now());
      for (const item of catalog.scripts) {
        const phaseCount=item.id==='hd-new-ap-20260725'?DEFAULT_PHASES.length:0;
        scriptInsert.run(item.id,item.departmentId,item.name,JSON.stringify(item.products),item.customerType,item.version,item.status,item.updatedAt||now(),phaseCount);
      }
      for (const item of DEFAULT_OBJECTIONS) {
        objection.run(item.id,item.category,item.subcategory,item.subcategory,item.phaseId,now());
        const texts = responseMap[item.id] || ['ご懸念を承知しました。登録されている正式情報だけでは回答できません。条件を確認してから回答します。','一番気になっている点を、もう少し具体的に教えていただけますか？','確認事項を整理し、正式な条件が分かってから改めて回答します。'];
        texts.forEach((text,index) => response.run(`${item.id}-${index + 1}`,item.id,['標準返答','切り分け質問','説明・再提案'][index],text,index === 1 ? text : DEFAULT_PHASES.find(p=>p.id===item.phaseId)?.questions[0] || '次に確認すべき条件は何ですか？',item.phaseId,`approved:${item.id}-${index + 1}`,now()));
      }
    }); run();
  }
  phases(talkScriptId='hd-new-ap-20260725') {
    const custom=this.db.prepare('SELECT * FROM talk_script_phases WHERE talk_script_id=? AND status=? ORDER BY phase_order').all(talkScriptId,'published');
    if(custom.length)return custom.map(row=>({...row,required_questions:parse(row.required_questions),prohibited_phrases:parse(row.prohibited_phrases)}));
    return this.db.prepare("SELECT * FROM sales_phases WHERE status=? AND id NOT LIKE 'iv_%' ORDER BY phase_order").all('published').map(row => ({...row, required_questions:parse(row.required_questions), prohibited_phrases:parse(row.prohibited_phrases)}));
  }
  catalog() {
    const departments=this.db.prepare('SELECT * FROM departments ORDER BY name').all();
    const scripts=this.db.prepare('SELECT * FROM talk_scripts ORDER BY department_id,status DESC,name').all().map(row=>({...row,products:parse(row.products)}));
    const applicationGuide=loadSalesCatalog().applicationGuide;
    return { departments, scripts, applicationGuide };
  }
  updateTalkScript(id,data) {
    const script=this.db.prepare('SELECT * FROM talk_scripts WHERE id=?').get(id);if(!script)return null;
    const name=String(data.name||'').trim();if(!name)throw new Error('トークスクリプト名を入力してください');
    this.db.prepare('UPDATE talk_scripts SET name=?,title_customized=1,updated_at=? WHERE id=?').run(name,now(),id);
    this.audit(data.actor||'管理者','rename','talk_script',id,{previousName:script.name,name});
    return this.catalog().scripts.find(item=>item.id===id);
  }
  createTalkScript(data) {
    const name=String(data.name||'').trim();if(!name)throw new Error('トークスクリプト名を入力してください');
    const products=Array.isArray(data.products)?data.products:String(data.products||'').split(/[,、＋+\n]/).map(item=>item.trim()).filter(Boolean);
    if(!products.length)throw new Error('対象商材を1つ以上入力してください');
    const id=`hd-local-${crypto.randomUUID()}`,timestamp=now(),version=String(data.version||new Date().toLocaleDateString('ja-JP')).trim();
    this.db.prepare('INSERT INTO talk_scripts(id,department_id,name,products,customer_type,version,status,updated_at,phase_count,title_customized,local_created) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,'hd',name,JSON.stringify(products),String(data.customerType||'店舗オーナー・小規模事業者').trim(),version,'published',timestamp,DEFAULT_PHASES.length,1,1);
    this.audit(data.actor||'管理者','create','talk_script',id,{name,products,version});
    return this.catalog().scripts.find(item=>item.id===id);
  }
  replaceTalkScriptPhases(talkScriptId,phases,data={}) {
    const script=this.db.prepare('SELECT * FROM talk_scripts WHERE id=?').get(talkScriptId);if(!script)throw new Error('対象のトークスクリプトが見つかりません');
    if(!Array.isArray(phases)||!phases.length)throw new Error('登録するフェーズがありません');
    const timestamp=now(),insert=this.db.prepare('INSERT INTO talk_script_phases(id,talk_script_id,phase_order,group_name,name,goal,base_script,required_questions,transition_conditions,prohibited_phrases,version,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    this.db.transaction(()=>{
      this.db.prepare('DELETE FROM talk_script_phases WHERE talk_script_id=?').run(talkScriptId);
      phases.forEach((item,index)=>insert.run(item.id||`${talkScriptId}-${index+1}`,talkScriptId,item.order||index+1,item.group||String(index+1).padStart(2,'0'),item.name,item.goal||'',item.script||'',JSON.stringify(item.questions||[]),item.transition||'',JSON.stringify(item.prohibited||[]),1,'published',timestamp));
      this.db.prepare('UPDATE talk_scripts SET phase_count=?,version=?,updated_at=? WHERE id=?').run(phases.length,data.version||script.version,timestamp,talkScriptId);
    })();
    this.audit(data.actor||'管理者','replace_phases','talk_script',talkScriptId,{phaseCount:phases.length,version:data.version||script.version});
    return this.catalog().scripts.find(item=>item.id===talkScriptId);
  }
  objections() { return this.db.prepare('SELECT * FROM objections WHERE status=? ORDER BY category,subcategory').all('published'); }
  start(data) {
    const talkScript=this.db.prepare('SELECT * FROM talk_scripts WHERE id=? AND status=?').get(data.talkScriptId||'hd-new-ap-20260725','published');
    if(!talkScript) throw new Error('公開中のトークスクリプトを選択してください');
    const id = crypto.randomUUID(); const started = now();
    this.db.prepare(`INSERT INTO sales_sessions(id,staff_id,customer_name,business_type,owner_name,meeting_type,product_id,existing_hp,electricity_company,handoff,concerns,current_phase,department_id,talk_script_id,talk_script_version,context_data,deal_id,started_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id,data.staffId||'',data.customerName||'',data.businessType||'飲食店',data.ownerName||'',data.meetingType||'',data.productId||talkScript.products,data.existingHp||'',data.electricityCompany||'',data.handoff||'',data.concerns||'','agenda',talkScript.department_id,talkScript.id,talkScript.version,JSON.stringify(buildContext(data)),data.dealId||`deal_${crypto.randomUUID()}`,started);
    this.db.prepare('UPDATE talk_scripts SET use_count=use_count+1 WHERE id=?').run(talkScript.id);
    this.audit(data.staffId||'FS','start','sales_session',id,{ customerName:data.customerName||'' });
    return this.session(id);
  }
  prepare(data) {
    const talkScript=this.db.prepare('SELECT * FROM talk_scripts WHERE id=? AND status=?').get(data.talkScriptId||'hd-new-ap-20260725','published');
    if(!talkScript) throw new Error('公開中のトークスクリプトを選択してください');
    const id=crypto.randomUUID(),timestamp=now();
    const context=buildContext(data);
    this.db.prepare(`INSERT INTO sales_preparations(id,department_id,talk_script_id,talk_script_version,staff_id,customer_name,business_type,owner_name,meeting_type,existing_hp,electricity_company,handoff,concerns,context_data,next_action,next_action_at,deal_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id,talkScript.department_id,talkScript.id,talkScript.version,data.staffId||'',data.customerName||'',data.businessType||'飲食店',data.ownerName||'',data.meetingType||'',data.existingHp||'',data.electricityCompany||'',data.handoff||'',data.concerns||'',JSON.stringify(context),data.nextAction||'',data.nextActionAt||'',`deal_${crypto.randomUUID()}`,timestamp,timestamp);
    this.audit(data.staffId||'FS','prepare','sales_preparation',id,{talkScriptId:talkScript.id,version:talkScript.version});
    return this.preparation(id);
  }
  preparation(id) {
    const row=this.db.prepare('SELECT * FROM sales_preparations WHERE id=?').get(id);
    return row?{...row,context_data:parse(row.context_data,{})}:null;
  }
  preparations(limit=30) { return this.db.prepare("SELECT * FROM sales_preparations WHERE status IN ('prepared','opened') ORDER BY CASE WHEN COALESCE(json_extract(context_data,'$.meetingAt'),'')='' THEN 1 ELSE 0 END, ABS(julianday(COALESCE(json_extract(context_data,'$.meetingAt'),created_at))-julianday('now','localtime')) ASC, created_at DESC LIMIT ?").all(limit).map(row=>({...row,context_data:parse(row.context_data,{})})); }
  updatePreparation(id,data) {
    const prepared=this.preparation(id);if(!prepared)return null;
    this.db.prepare('UPDATE sales_preparations SET next_action=?,next_action_at=?,updated_at=? WHERE id=?').run(data.nextAction||'',data.nextActionAt||'',now(),id);
    this.audit(data.actor||'FS','update_next_action','sales_preparation',id,{nextAction:data.nextAction||'',nextActionAt:data.nextActionAt||''});
    return this.preparation(id);
  }
  editPreparation(id,data) {
    const prepared=this.preparation(id);if(!prepared)return null;
    const context={...prepared.context_data,...buildContext({...prepared.context_data,...data})};
    const value=(key,column)=>data[key]===undefined?prepared[column]:String(data[key]||'');
    this.db.prepare('UPDATE sales_preparations SET customer_name=?,owner_name=?,staff_id=?,existing_hp=?,handoff=?,concerns=?,status=?,context_data=?,updated_at=? WHERE id=?')
      .run(value('customerName','customer_name'),value('ownerName','owner_name'),value('staffId','staff_id'),value('existingHp','existing_hp'),value('handoff','handoff'),value('concerns','concerns'),data.status||prepared.status,JSON.stringify(context),now(),id);
    this.audit(data.actor||'FS','edit','sales_preparation',id,{customerName:value('customerName','customer_name'),status:data.status||prepared.status});
    return this.preparation(id);
  }
  openPreparation(id) {
    const prepared=this.preparation(id);if(!prepared) return null;
    if(prepared.session_id){const existing=this.session(prepared.session_id);if(existing){this.db.prepare("UPDATE sales_sessions SET interrupted_at='' WHERE id=?").run(existing.id);return this.session(existing.id)}}
    const context=prepared.context_data;
    const session=this.start({departmentId:prepared.department_id,talkScriptId:prepared.talk_script_id,staffId:prepared.staff_id,customerName:prepared.customer_name,businessType:prepared.business_type,ownerName:prepared.owner_name,meetingType:prepared.meeting_type,existingHp:prepared.existing_hp,electricityCompany:prepared.electricity_company,handoff:prepared.handoff,concerns:prepared.concerns,dealId:prepared.deal_id,...context});
    this.db.prepare("UPDATE sales_preparations SET status='opened',opened_at=?,session_id=?,updated_at=? WHERE id=?").run(now(),session.id,now(),id);
    this.audit(prepared.staff_id||'FS','open','sales_preparation',id,{sessionId:session.id});
    return this.session(session.id);
  }
  session(id) {
    const row = this.db.prepare('SELECT * FROM sales_sessions WHERE id=?').get(id);
    return row ? { ...row, context_data:parse(row.context_data,{}), step_state:parse(row.step_state,{}) } : null;
  }
  suggest(data) {
    const objection = this.db.prepare('SELECT * FROM objections WHERE id=?').get(data.objectionId) || this.db.prepare('SELECT * FROM objections WHERE id=?').get('other');
    const candidates = this.db.prepare('SELECT * FROM objection_responses WHERE objection_id=? AND status=? ORDER BY id LIMIT 3').all(objection.id,'published');
    const phase = this.db.prepare('SELECT * FROM sales_phases WHERE id=?').get(data.phaseId);
    const prohibited = parse(phase?.prohibited_phrases || '[]');
    const warnings = prohibited.filter(value => String(data.statement||'').includes(value));
    const id = crypto.randomUUID();
    this.db.prepare('INSERT INTO ai_suggestions(id,session_id,phase_id,customer_statement,detected_objection,generated_candidates,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id,data.sessionId,data.phaseId,data.statement||'',objection.id,JSON.stringify(candidates),now());
    this.db.prepare('UPDATE sales_sessions SET current_phase=? WHERE id=?').run(data.phaseId,data.sessionId);
    return { id, objection, candidates, warnings, aiUsed:false, notice:'承認済みアウト返しを表示しています' };
  }
  addFact(sessionId,data) {
    if(!this.session(sessionId))return null;
    const fact={id:crypto.randomUUID(),session_id:sessionId,category:data.category||'log',value:String(data.value||'').trim(),source:data.source||'fs_input',created_at:now()};
    if(!fact.value)throw new Error('記録内容を入力してください');
    this.db.prepare('INSERT INTO sales_facts(id,session_id,category,value,source,created_at) VALUES(?,?,?,?,?,?)').run(fact.id,fact.session_id,fact.category,fact.value,fact.source,fact.created_at);
    return fact;
  }
  sessionRecord(sessionId) {
    const facts=this.db.prepare('SELECT * FROM sales_facts WHERE session_id=? ORDER BY created_at').all(sessionId);
    const objections=this.db.prepare('SELECT * FROM ai_suggestions WHERE session_id=? ORDER BY created_at DESC').all(sessionId).map(row=>({...row,generated_candidates:parse(row.generated_candidates)}));
    return {facts,objections};
  }
  objectionHistory(limit=100) {
    return this.db.prepare(`SELECT a.*,s.customer_name,s.talk_script_version FROM ai_suggestions a LEFT JOIN sales_sessions s ON s.id=a.session_id ORDER BY a.created_at DESC LIMIT ?`).all(limit).map(row=>({...row,generated_candidates:parse(row.generated_candidates)}));
  }
  objectionNotes(talkScriptId,limit=50) {
    return this.db.prepare('SELECT * FROM talk_script_objection_notes WHERE talk_script_id=? ORDER BY created_at DESC LIMIT ?').all(talkScriptId,limit).map(row=>({...row,predicted_objections:parse(row.predicted_objections),commitments:parse(row.commitments),objection_signals:parse(row.objection_signals)}));
  }
  addObjectionNote(talkScriptId,data) {
    const script=this.db.prepare('SELECT * FROM talk_scripts WHERE id=?').get(talkScriptId);if(!script)return null;
    const memo=String(data.memo||'').trim();if(!memo)throw new Error('殴り書きメモを入力してください');
    const rules=[
      ['free_distrust',/無料|費用|怪し|本当|あとから|後から/],
      ['electricity_satisfied',/電気.*変え|切り替えたくない|今の電気|満足/],
      ['electricity_past_rise',/高く|上がっ|値上がり/],
      ['decision_maker',/決裁|家族|共同|相談|確認者/],
      ['hp_unneeded',/HP.*不要|ホームページ.*いら|必要ない/],
      ['existing_hp',/既存.*HP|ホームページ.*ある|すでに.*サイト/],
      ['sns_enough',/SNS.*十分|Instagram.*十分|Google.*十分/],
      ['compare',/比較|検討|他社/],
      ['no_time',/時間|忙し|急いで/]
    ];
    const ids=rules.filter(([,pattern])=>pattern.test(memo)).map(([id])=>id);if(!ids.length)ids.push('other');
    const statements=memo.split(/[\n。！？!?]+/).map(item=>item.trim()).filter(Boolean);
    const commitments=statements.filter(item=>/作りたい|やりたい|興味|良い|いいと思|問題ない|検討|確認する|相談する|送る|用意する|進め/.test(item)).slice(0,6);
    const objectionSignals=statements.filter(item=>/不安|疑|怪し|嫌|いらない|必要ない|難しい|高い|変えたく|できない|分からない|確認が必要|相談が必要|条件/.test(item)).slice(0,6);
    const reactionSummary=/いらない|必要ない|断る|やらない/.test(memo)?'拒否感あり：必要性や断る理由の切り分けが必要':/半信半疑|疑|怪し|不安/.test(memo)?'慎重・半信半疑：根拠と条件を明確にすると判断が進みそう':/条件|相談|確認/.test(memo)?'条件付き・確認待ち：判断条件と確認相手を整理する':/作りたい|興味|良い|進め/.test(memo)?'前向き：条件確認後の具体的な次の行動を決める':'反応を追加確認：相手の言葉と判断条件をもう少し記録する';
    const predicted=ids.slice(0,4).map(id=>{
      const objection=this.db.prepare('SELECT * FROM objections WHERE id=?').get(id);
      const response=this.db.prepare('SELECT response_text,next_question,source_id FROM objection_responses WHERE objection_id=? AND status=? ORDER BY id LIMIT 1').get(id,'published');
      return {id,category:objection?.category||'その他',subcategory:objection?.subcategory||'追加確認が必要',responseText:response?.response_text||'ご懸念を正しく理解するため、もう少し詳しく教えていただけますか？',nextQuestion:response?.next_question||'一番気になっている点はどこですか？',sourceId:response?.source_id||'approved:other'};
    });
    const id=crypto.randomUUID(),timestamp=now();
    this.db.prepare('INSERT INTO talk_script_objection_notes(id,talk_script_id,session_id,phase_id,memo,predicted_objections,reaction_summary,commitments,objection_signals,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,talkScriptId,data.sessionId||'',data.phaseId||'',memo,JSON.stringify(predicted),reactionSummary,JSON.stringify(commitments),JSON.stringify(objectionSignals),timestamp);
    this.audit(data.actor||'FS','save_objection_note','talk_script',talkScriptId,{noteId:id,predicted:ids});
    return {...this.db.prepare('SELECT * FROM talk_script_objection_notes WHERE id=?').get(id),predicted_objections:predicted,commitments,objection_signals:objectionSignals};
  }
  useSuggestion(id, selectedCandidate) {
    const row = this.db.prepare('SELECT * FROM ai_suggestions WHERE id=?').get(id);
    if (!row) return null;
    this.db.prepare('UPDATE ai_suggestions SET selected_candidate=?, used=1 WHERE id=?').run(selectedCandidate,id);
    this.audit('FS','use_suggestion','ai_suggestion',id,{ selectedCandidate });
    return { ...row, selected_candidate:selectedCandidate, used:1 };
  }
  finish(id,data) {
    const previous=this.session(id);
    this.db.prepare("UPDATE sales_sessions SET notes=?,result=?,next_action=?,next_action_at=?,current_phase=?,forecast=?,reflection=?,interrupted_at='',finished_at=? WHERE id=?")
      .run(data.notes||'',data.result||'',data.nextAction||'',data.nextActionDate||'','enepal_card',data.forecast??previous?.forecast??'',data.reflection??previous?.reflection??'',now(),id);
    this.audit(data.staffId||'FS','finish','sales_session',id,{ result:data.result||'', nextAction:data.nextAction||'' });
    return this.session(id);
  }
  interrupt(id,data={}) {
    const session=this.session(id);if(!session||session.finished_at)return null;
    this.db.prepare('UPDATE sales_sessions SET interrupted_at=?,current_phase=? WHERE id=?').run(now(),data.currentPhase||session.current_phase,id);
    this.audit(data.actor||'FS','interrupt','sales_session',id,{ currentPhase:data.currentPhase||session.current_phase });
    return this.session(id);
  }
  addMeetingMemo(meetingId,data) {
    if(!this.session(meetingId))return null;
    const content=String(data.content||'').trim();if(!content)throw new Error('メモを入力してください');
    const memo={id:`memo_${crypto.randomUUID()}`,meeting_id:meetingId,phase_id:String(data.phaseId||''),content,created_at:now()};
    this.db.prepare('INSERT INTO meeting_memos(id,meeting_id,phase_id,content,created_at) VALUES(?,?,?,?,?)').run(memo.id,memo.meeting_id,memo.phase_id,memo.content,memo.created_at);
    return memo;
  }
  meetingMemos(meetingId,limit=500) {
    if(!this.session(meetingId))return null;
    return this.db.prepare('SELECT * FROM meeting_memos WHERE meeting_id=? ORDER BY created_at LIMIT ?').all(meetingId,limit);
  }
  saveMemoDraft(meetingId,content) {
    const session=this.session(meetingId);if(!session)return null;
    this.db.prepare('UPDATE sales_sessions SET memo_draft=? WHERE id=?').run(String(content||''),meetingId);
    return { meetingId, savedAt:now() };
  }
  factSummary(sessionId,category) {
    return this.db.prepare('SELECT value FROM sales_facts WHERE session_id=? AND category=? ORDER BY created_at').all(sessionId,category).map(row=>row.value).join('\n');
  }
  phaseName(talkScriptId,phaseId) {
    if(!phaseId)return '';
    return this.phases(talkScriptId||'hd-new-ap-20260725').find(item=>item.id===phaseId)?.name||phaseId;
  }
  dealOf(preparation,session) {
    // 進行中は商談準備の最新内容を反映し、終了後は当時のスナップショット（商談セッション側）を残す
    const primary=!preparation||session?.finished_at?session:preparation;
    const context={...buildContext({}),...(primary?.context_data||{})};
    const source=primary||{};
    const status=dealStatus({preparationStatus:preparation?.status,session,meetingAt:context.meetingAt});
    return {
      dealId:preparation?.deal_id||session?.deal_id||'',
      preparationId:preparation?.id||'',
      meetingId:session?.id||'',
      status,
      storeName:source.customer_name||'',
      ownerName:source.owner_name||'',
      staffId:source.staff_id||'',
      isPerson:context.isPerson||'',
      meetingAt:context.meetingAt||'',
      products:context.targetProducts||'',
      isNotes:context.isNotes||'',
      handoff:source.handoff||'',
      concerns:source.concerns||'',
      address:context.address||'',
      storePhone:context.storePhone||'',
      mobile:context.mobile||'',
      decisionMaker:context.decisionMaker||'',
      existingHp:source.existing_hp||'',
      temperature:context.temperature||'',
      temperatureReason:context.temperatureReason||'',
      issues:context.issues||'',
      hookPoints:context.hookPoints||'',
      appointmentPattern:context.appointmentPattern||'',
      appointmentBackground:context.appointmentBackground||'',
      websiteUrl:context.websiteUrl||'',
      instagramUrl:context.instagramUrl||'',
      googleMapsUrl:context.googleMapsUrl||'',
      otherLinks:Array.isArray(context.otherLinks)?context.otherLinks:[],
      talkScriptId:source.talk_script_id||'',
      talkScriptVersion:source.talk_script_version||'',
      currentPhaseId:session?.current_phase||'',
      currentPhaseName:session?this.phaseName(session.talk_script_id,session.current_phase):'',
      nextAction:session?.next_action||preparation?.next_action||'',
      nextActionAt:session?.next_action_at||preparation?.next_action_at||'',
      result:session?.result||'',
      acquiredProducts:session?this.factSummary(session.id,'acquired_products'):'',
      forecast:session?.forecast||'',
      reflection:session?.reflection||'',
      startedAt:session?.started_at||'',
      finishedAt:session?.finished_at||'',
      interruptedAt:session?.interrupted_at||'',
      updatedAt:session?.finished_at||session?.interrupted_at||session?.started_at||preparation?.updated_at||''
    };
  }
  deals(limit=200) {
    const preparations=this.db.prepare('SELECT * FROM sales_preparations ORDER BY created_at DESC LIMIT ?').all(limit).map(row=>({...row,context_data:parse(row.context_data,{})}));
    const linked=new Set(preparations.map(row=>row.session_id).filter(Boolean));
    const list=preparations.map(row=>this.dealOf(row,row.session_id?this.session(row.session_id):null));
    for(const row of this.recent(limit)) if(!linked.has(row.id)) list.push(this.dealOf(null,row));
    return list.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  activeDeals(limit=200) { return this.deals(limit).filter(item=>!['商談完了','失注','キャンセル'].includes(item.status)); }
  finishedDeals(limit=200) { return this.deals(limit).filter(item=>Boolean(item.finishedAt)||item.status==='キャンセル'); }
  deal(id) {
    const preparation=this.db.prepare('SELECT * FROM sales_preparations WHERE deal_id=? OR id=? OR session_id=?').get(id,id,id);
    const prepared=preparation?this.preparation(preparation.id):null;
    const session=prepared?.session_id?this.session(prepared.session_id):this.session(id)||this.db.prepare('SELECT id FROM sales_sessions WHERE deal_id=? ORDER BY started_at DESC').all(id).map(row=>this.session(row.id))[0]||null;
    if(!prepared&&!session)return null;
    const deal=this.dealOf(prepared,session);
    return { deal, memos:session?this.meetingMemos(session.id):[], memoDraft:session?.memo_draft||'', session, preparation:prepared, record:session?this.sessionRecord(session.id):{facts:[],objections:[]} };
  }
  updateProgress(id,data) {
    const session = this.session(id);
    if (!session) return null;
    const context = { ...session.context_data, ...(data.contextData || {}) };
    const state = { ...session.step_state, ...(data.stepState || {}) };
    this.db.prepare('UPDATE sales_sessions SET current_phase=?,context_data=?,step_state=?,notes=? WHERE id=?')
      .run(data.currentPhase || session.current_phase,JSON.stringify(context),JSON.stringify(state),data.notes ?? session.notes,id);
    return this.session(id);
  }
  updatePhase(id,data) {
    const custom=this.db.prepare('SELECT * FROM talk_script_phases WHERE id=?').get(id);
    const existing = custom||this.db.prepare('SELECT * FROM sales_phases WHERE id=?').get(id);
    if (!existing) return null;
    const table=custom?'talk_script_phases':'sales_phases';
    this.db.prepare(`UPDATE ${table} SET goal=?,base_script=?,required_questions=?,transition_conditions=?,prohibited_phrases=?,version=version+1,updated_at=? WHERE id=?`)
      .run(data.goal,data.baseScript,JSON.stringify(data.requiredQuestions||[]),data.transitionConditions,JSON.stringify(data.prohibitedPhrases||[]),now(),id);
    this.audit(data.actor||'管理者','update','sales_phase',id,{ previousVersion:existing.version });
    return this.phases(custom?.talk_script_id||'hd-new-ap-20260725').find(item=>item.id===id);
  }
  recent(limit=20) { return this.db.prepare('SELECT * FROM sales_sessions ORDER BY started_at DESC LIMIT ?').all(limit).map(row => ({...row,context_data:parse(row.context_data,{}),step_state:parse(row.step_state,{})})); }
  audit(actor,action,entityType,entityId,detail) { this.db.prepare('INSERT INTO audit_logs(actor,action,entity_type,entity_id,detail,created_at) VALUES(?,?,?,?,?,?)').run(actor,action,entityType,entityId,JSON.stringify(detail),now()); }
  close() { this.db.close(); }
}

import fs from 'node:fs';
import path from 'node:path';

const MANAGED_START = '<!-- HD_AI_ASSISTANT_MANAGED_START -->';
const MANAGED_END = '<!-- HD_AI_ASSISTANT_MANAGED_END -->';

const DEPARTMENTS = {
  IS: { status: 'active', modules: ['IS_リスト取得', 'IS_Comdesk', 'IS_架電管理', 'IS_前確管理', 'IS_アポ管理', 'IS_KPI'] },
  FS: { status: 'active', modules: ['FS_商談準備', 'FS_トークスクリプト', 'FS_商談資料', 'FS_商談管理', 'FS_商談結果と振り返り', 'FS_引き継ぎFMT', 'FS_KPI'] },
  CS: { status: 'planned', modules: ['CS_制作引き継ぎ', 'CS_制作進捗', 'CS_素材回収', 'CS_修正管理', 'CS_公開管理'] }
};

const COMMON_NOTES = {
  HD_商材: '商材',
  HD_顧客: '顧客',
  HD_KPI定義: 'KPI定義',
  HD_業務ルール: '業務ルール'
};

function buildFrontmatter(fields) {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join('\n')}\n---`;
}

// 自動生成領域(MANAGED_START〜END)だけを差し替え、それ以降のユーザー自由記述はそのまま残す
function splitManaged(content) {
  const startIndex = content.indexOf(MANAGED_START);
  const endIndex = content.indexOf(MANAGED_END);
  if (startIndex === -1 || endIndex === -1) return null;
  return { after: content.slice(endIndex + MANAGED_END.length) };
}

export class ObsidianHdArchitecture {
  constructor({ archive, store, config = {} } = {}) {
    this.archive = archive;
    this.store = store;
    this.rootNote = config.rootNote || 'HD事業部/HDシステム.md';
    this.baseDir = path.dirname(this.rootNote);
    this.departmentNotes = {
      IS: config.isNote || `${this.baseDir}/IS/IS.md`,
      FS: config.fsNote || `${this.baseDir}/FS/FS.md`,
      CS: config.csNote || `${this.baseDir}/CS/CS.md`
    };
  }

  vaultRoot() {
    return this.archive.vaultPath();
  }

  // 新規なら丸ごと作成、既存ならmanaged領域だけ再構築してユーザー自由記述(END以降)を保護する
  writeManaged(relativePath, frontmatterFields, managedBody) {
    const target = path.join(this.vaultRoot(), relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const frontmatter = buildFrontmatter(frontmatterFields);
    const managedBlock = `${MANAGED_START}\n${managedBody.trim()}\n${MANAGED_END}`;
    if (!fs.existsSync(target)) {
      const content = `${frontmatter}\n\n${managedBlock}\n\n## 自由メモ\n\nここはユーザーが自由に編集可能\n`;
      fs.writeFileSync(target, content, 'utf8');
      return target;
    }
    const existing = fs.readFileSync(target, 'utf8');
    const split = splitManaged(existing);
    if (!split) return target; // managedマーカーが無い＝手動作成ファイルとみなし触らない
    const rebuilt = `${frontmatter}\n\n${managedBlock}${split.after}`;
    if (rebuilt !== existing) fs.writeFileSync(target, rebuilt, 'utf8');
    return target;
  }

  ensureRootNote() {
    const body = `# HDシステム

HD事業部の業務・システム全体をつなぐ親ノート。

## 部署

- [[IS]]
- [[FS]]
- [[CS]]

## 共通

- [[HD_商材]]
- [[HD_顧客]]
- [[HD_KPI定義]]
- [[HD_業務ルール]]`;
    return this.writeManaged(this.rootNote, {
      type: 'hd-system-root', department: 'HD', status: 'active', managed_by: 'hd-ai-assistant', managed_version: 1
    }, body);
  }

  ensureDepartmentNotes() {
    return Object.entries(DEPARTMENTS).map(([dept, info]) => {
      const list = info.modules.map(name => `- [[${name}]]`).join('\n');
      const body = `# ${dept}

親：[[HDシステム]]

## ${dept}システム

${list}`;
      return this.writeManaged(this.departmentNotes[dept], {
        type: 'hd-department', department: dept, parent: 'HDシステム', status: info.status, managed_by: 'hd-ai-assistant', managed_version: 1
      }, body);
    });
  }

  ensureModuleNotes() {
    const results = [];
    for (const [dept, info] of Object.entries(DEPARTMENTS)) {
      const deptDir = path.dirname(this.departmentNotes[dept]);
      for (const moduleName of info.modules) {
        const shortName = moduleName.replace(`${dept}_`, '');
        const body = `# ${dept} ${shortName}

親：[[${dept}]]
上位：[[HDシステム]]

## 役割

HD AIアシスタントの${dept}${shortName}情報を扱う。`;
        results.push(this.writeManaged(`${deptDir}/${moduleName}.md`, {
          type: 'hd-system-module', department: dept, status: info.status, managed_by: 'hd-ai-assistant', managed_version: 1
        }, body));
      }
    }
    return results;
  }

  ensureCommonNotes() {
    const commonDir = `${this.baseDir}/共通`;
    return Object.entries(COMMON_NOTES).map(([name, title]) => {
      const body = `# ${title}

親：[[HDシステム]]`;
      return this.writeManaged(`${commonDir}/${name}.md`, {
        type: 'hd-common', department: 'HD', parent: 'HDシステム', managed_by: 'hd-ai-assistant', managed_version: 1
      }, body);
    });
  }

  // 実顧客は生成しない。複製して使うための空テンプレートを1枚だけ用意する
  ensureCustomerTemplate() {
    const target = path.join(this.vaultRoot(), `${this.baseDir}/共通/顧客/_顧客テンプレート.md`);
    if (fs.existsSync(target)) return target;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const content = `---
type: hd-customer
customer_id: ""
customer_name: ""
---

# 顧客名

## 関連部署

- [[IS]]
- [[FS]]
- [[CS]]

## IS

## FS

## CS
`;
    fs.writeFileSync(target, content, 'utf8');
    return target;
  }

  ensureGraphViewGuide() {
    const target = `${this.baseDir}/HD_グラフビュー設定.md`;
    const body = `# HD グラフビュー設定

Graph View / Local GraphのFilter欄にそのまま貼り付けて使うクエリ例。
\`.obsidian/\`側の設定は変更しない。

## HD事業部だけを見る

\`\`\`
path:"HD事業部"
\`\`\`

## README / LICENSE / CHANGELOGを除外する

\`\`\`
-file:"README" -file:"LICENSE" -file:"CHANGELOG"
\`\`\`

## FSだけを見る

\`\`\`
path:"HD事業部/FS"
\`\`\`

## 使い方

1. \`HD事業部/HDシステム.md\` を開く
2. 右上のGraphアイコンからLocal Graphを開く
3. Filterに上記クエリを入力する（組み合わせ可: \`path:"HD事業部" -file:"README"\`）
4. \`HDシステム → IS / FS / CS → 各機能\` のつながりが見やすくなる`;
    return this.writeManaged(target, {
      type: 'hd-graph-guide', department: 'HD', managed_by: 'hd-ai-assistant', managed_version: 1
    }, body);
  }

  ensureStructure() {
    return {
      root: this.ensureRootNote(),
      departments: this.ensureDepartmentNotes(),
      modules: this.ensureModuleNotes(),
      common: this.ensureCommonNotes(),
      customerTemplate: this.ensureCustomerTemplate(),
      graphGuide: this.ensureGraphViewGuide()
    };
  }
}

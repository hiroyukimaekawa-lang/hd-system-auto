// 任意のLLM provider抽象化。
//
// 環境変数（HD_LLM_ENDPOINT / HD_LLM_API_KEY）が両方設定されている場合だけ有効になる。
// 未設定のこの環境（APIキーなし）では常に available=false を返し、呼び出し側は
// 「承認済みアウト返し集」「見出しルールパーサー」だけで動作する（AIなしで完結する）。
//
// 実際にLLMを呼び出した候補だけを「AI候補」と表記するため、available=false のときは
// 絶対にAI候補を生成しない（フェイクのAI応答を返さない）。
const endpoint = () => String(process.env.HD_LLM_ENDPOINT || '').trim();
const apiKey = () => String(process.env.HD_LLM_API_KEY || '').trim();

export function getLlmProvider() {
  const url = endpoint(), key = apiKey();
  if (!url || !key) return null;
  return {
    available: true,
    model: process.env.HD_LLM_MODEL || '',
    // アウト返しのAI補完候補（tier3）。呼び出し元でHTTPエラー時はnullを返し、承認済み候補のみにフォールバックする。
    async generateObjectionCandidates({ statement, phaseName }) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: this.model, task: 'objection_candidates', statement, phaseName })
      });
      if (!response.ok) return null;
      const data = await response.json();
      return Array.isArray(data?.candidates) ? data.candidates.slice(0, 3) : null;
    },
    // 見出しが無い自由文の構造化補助（OptionalLLMParser）。原文の言い換えは禁止し、分割位置の提案のみを受け取る契約とする。
    async parseScriptStructure(rawText) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: this.model, task: 'script_structure', text: rawText })
      });
      if (!response.ok) return null;
      const data = await response.json();
      return Array.isArray(data?.phases) ? data : null;
    }
  };
}

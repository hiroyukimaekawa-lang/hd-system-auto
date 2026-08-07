// HD AIアシスタント > IS > リスト生成 > 自動取得。
// app.js（FS）のヘルパーには依存しない自己完結スクリプト。
(function () {
  const qs = (selector, root = document) => root.querySelector(selector);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  const api = async (url, options = {}) => {
    const response = await fetch(url, { headers: { 'content-type': 'application/json' }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.text || `リクエストに失敗しました（${response.status}）`);
    return data;
  };

  let areasLoaded = false;
  let currentJobId = null;
  let pollTimer = null;

  const STATUS_LABEL = { queued: '待機中', running: '実行中', paused: '一時停止', completed: '完了', failed: '失敗', needs_human: '要確認（CAPTCHA等）', cancelled: '中止' };
  const STAGE_LABEL = { drive_scan: 'Drive確認', maps: 'Google Maps取得中', tabelog: '食べログ取得中', normalize: '正規化中', merge: '統合中', exclude: '除外判定中', phone_enrichment: '電話番号補完中', csv_export: 'CSV生成中', drive_upload: 'Driveへ保存中', done: '完了' };

  async function ensureAreasLoaded() {
    if (areasLoaded) return;
    const select = qs('#is-lg-area');
    if (!select) return;
    try {
      const data = await api('/api/is/list-generation/areas');
      select.innerHTML = data.areas.length
        ? data.areas.map(area => `<option value="${escapeHtml(area.id)}" data-name="${escapeHtml(area.name)}">${escapeHtml(area.name)}</option>`).join('')
        : '<option value="">エリアが見つかりません</option>';
      areasLoaded = true;
    } catch (error) {
      select.innerHTML = '<option value="">読み込みに失敗しました</option>';
      qs('#is-lg-run-hint').textContent = error.message;
    }
  }

  function renderJob(job) {
    qs('#is-lg-status').hidden = false;
    qs('#is-lg-status-title').textContent = `${job.drive?.areaName || job.input.areaName || ''} / ${job.input.genre}`;
    qs('#is-lg-status-sub').textContent = `現在: ${STAGE_LABEL[job.stage] || job.stage}`;
    const badge = qs('#is-lg-status-badge');
    badge.textContent = STATUS_LABEL[job.status] || job.status;
    badge.className = `badge badge-${job.status}`;
    const c = job.counts || {};
    qs('#is-lg-count-maps').textContent = c.maps || 0;
    qs('#is-lg-count-tabelog').textContent = c.tabelog || 0;
    qs('#is-lg-count-merged').textContent = c.merged || 0;
    qs('#is-lg-count-dup').textContent = c.duplicatesRemoved || 0;
    qs('#is-lg-count-chain').textContent = c.chainExcluded || 0;
    qs('#is-lg-count-other').textContent = c.otherExcluded || 0;
    qs('#is-lg-count-phone').textContent = c.phoneEnriched || 0;
    qs('#is-lg-count-final').textContent = c.final || 0;
    qs('#is-lg-pause').disabled = !['queued', 'running'].includes(job.status);
    qs('#is-lg-resume').disabled = !['paused', 'needs_human'].includes(job.status);
    qs('#is-lg-cancel').disabled = ['completed', 'failed', 'cancelled'].includes(job.status);
    if (['completed', 'failed', 'cancelled', 'needs_human'].includes(job.status) && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  async function pollJob(jobId) {
    try { const data = await api(`/api/is/list-generation/jobs/${encodeURIComponent(jobId)}`); renderJob(data.job); }
    catch (error) { qs('#is-lg-run-hint').textContent = error.message; }
  }

  async function refreshLog() {
    if (!currentJobId) return;
    try {
      const data = await api(`/api/is/list-generation/jobs/${encodeURIComponent(currentJobId)}/log`);
      qs('#is-lg-log').textContent = data.log.map(entry => `[${entry.at || ''}] ${entry.message}`).join('\n');
    } catch (error) { qs('#is-lg-log').textContent = error.message; }
  }

  async function callAction(action) {
    if (!currentJobId) return;
    try { const data = await api(`/api/is/list-generation/jobs/${encodeURIComponent(currentJobId)}/${action}`, { method: 'POST' }); renderJob(data.job); if (action === 'resume' && !pollTimer) pollTimer = setInterval(() => pollJob(currentJobId), 1500); }
    catch (error) { qs('#is-lg-run-hint').textContent = error.message; }
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-view="is-list-generation"]')) ensureAreasLoaded();
  });

  document.addEventListener('DOMContentLoaded', () => {
    const runButton = qs('#is-lg-run');
    if (!runButton) return;
    runButton.addEventListener('click', async () => {
      const areaSelect = qs('#is-lg-area');
      const option = areaSelect.selectedOptions[0];
      const genre = qs('#is-lg-genre').value.trim();
      if (!option || !option.value || !genre) { qs('#is-lg-run-hint').textContent = 'エリアとジャンルを指定してください'; return; }
      const sources = [];
      if (qs('#is-lg-src-maps').checked) sources.push('google_maps');
      if (qs('#is-lg-src-tabelog').checked) sources.push('tabelog');
      runButton.disabled = true; qs('#is-lg-run-hint').textContent = '受け付け中…';
      try {
        const data = await api('/api/is/list-generation/jobs', {
          method: 'POST',
          body: JSON.stringify({ areaFolderId: option.value, areaName: option.dataset.name || option.textContent, genre, sources, maxItems: 5 })
        });
        currentJobId = data.job.jobId;
        qs('#is-lg-run-hint').textContent = `ジョブID：${currentJobId}`;
        renderJob(data.job);
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(() => pollJob(currentJobId), 1500);
      } catch (error) { qs('#is-lg-run-hint').textContent = error.message; }
      finally { runButton.disabled = false; }
    });
    qs('#is-lg-pause').addEventListener('click', () => callAction('pause'));
    qs('#is-lg-resume').addEventListener('click', () => callAction('resume'));
    qs('#is-lg-cancel').addEventListener('click', () => callAction('cancel'));
    qs('#is-lg-log-toggle').addEventListener('click', async () => { const pre = qs('#is-lg-log'); pre.hidden = !pre.hidden; if (!pre.hidden) await refreshLog(); });
  });
})();

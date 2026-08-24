// トークスクリプト管理：質問・NG表現のような「1行1項目」リストを、巨大な1つのテキストエリアではなく
// 追加・編集・削除・並び替えができる個別行として編集するための部品。利用者入力はすべてDOM APIで組み立てる。
function fsScriptAdminNode(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

// container配下に、文字列配列を1行1項目で編集できるUIを描画する。戻り値のgetValue()で現在の配列を取得できる。
function fsListEditor(container, items, { itemLabel = '項目', addLabel = '＋ 追加', placeholder = '', multiline = false, onChange } = {}) {
  const state = Array.isArray(items) ? [...items] : [];
  const emit = () => { if (onChange) onChange([...state]); };
  let render;
  function renderRow(value, index) {
    const label = fsScriptAdminNode('span', { class: 'fs-list-row-label', text: `${itemLabel}${index + 1}` });
    const up = fsScriptAdminNode('button', { type: 'button', class: 'fs-list-row-move', text: '↑' });
    up.disabled = index === 0;
    const down = fsScriptAdminNode('button', { type: 'button', class: 'fs-list-row-move', text: '↓' });
    down.disabled = index === state.length - 1;
    const remove = fsScriptAdminNode('button', { type: 'button', class: 'fs-list-row-remove danger', text: '削除' });
    const head = fsScriptAdminNode('div', { class: 'fs-list-row-head' }, [label, up, down, remove]);
    const input = fsScriptAdminNode(multiline ? 'textarea' : 'input', { placeholder, rows: multiline ? '2' : undefined });
    input.value = value;
    input.addEventListener('input', () => { state[index] = input.value; emit(); });
    up.addEventListener('click', () => { if (index <= 0) return; [state[index - 1], state[index]] = [state[index], state[index - 1]]; emit(); render(); });
    down.addEventListener('click', () => { if (index >= state.length - 1) return; [state[index + 1], state[index]] = [state[index], state[index + 1]]; emit(); render(); });
    remove.addEventListener('click', () => { state.splice(index, 1); emit(); render(); });
    return fsScriptAdminNode('div', { class: 'fs-list-row' }, [head, input]);
  }
  render = () => {
    container.textContent = '';
    if (!state.length) container.append(fsScriptAdminNode('p', { class: 'muted small fs-list-empty', text: 'まだ登録されていません。' }));
    state.forEach((value, index) => container.append(renderRow(value, index)));
    const addButton = fsScriptAdminNode('button', { type: 'button', class: 'secondary fs-list-add', text: addLabel });
    addButton.addEventListener('click', () => {
      state.push('');
      emit();
      render();
      requestAnimationFrame(() => {
        const inputs = container.querySelectorAll(multiline ? 'textarea' : 'input');
        inputs[inputs.length - 1]?.focus();
      });
    });
    container.append(addButton);
  };
  render();
  return {
    getValue: () => [...state],
    setValue: next => { state.length = 0; state.push(...(Array.isArray(next) ? next : [])); render(); }
  };
}

const FS_VERSION_ACTION_LABEL = { publish: '公開', restore: '復元' };
// 公開履歴の一覧を描画する。onPreview/onRestoreはバージョン行のボタンから呼ばれる
function fsVersionHistoryList(container, versions, { onPreview, onRestore } = {}) {
  container.textContent = '';
  if (!versions || !versions.length) {
    container.append(fsScriptAdminNode('p', { class: 'muted small', text: 'まだ公開履歴はありません。下書きを保存して公開すると、ここに記録されます。' }));
    return;
  }
  for (const version of versions) {
    const title = fsScriptAdminNode('b', { text: `Ver.${version.version_number}` });
    const actionBadge = fsScriptAdminNode('span', { class: `fs-version-action fs-version-action-${version.action}`, text: version.action === 'restore' ? `復元（Ver.${version.restored_from}から）` : (FS_VERSION_ACTION_LABEL[version.action] || version.action) });
    const when = fsScriptAdminNode('small', { text: String(version.created_at || '').replace('T', ' ').slice(0, 16) });
    const head = fsScriptAdminNode('div', { class: 'fs-version-head' }, [title, actionBadge, when]);
    const note = fsScriptAdminNode('p', { class: 'muted small', text: version.change_note || '（変更メモなし）' });
    const by = fsScriptAdminNode('small', { class: 'muted', text: `更新者：${version.created_by || '不明'}` });
    const previewButton = fsScriptAdminNode('button', { type: 'button', class: 'secondary', text: '内容確認' });
    previewButton.addEventListener('click', () => onPreview?.(version));
    const restoreButton = fsScriptAdminNode('button', { type: 'button', class: 'primary', text: 'このバージョンを復元' });
    restoreButton.addEventListener('click', () => onRestore?.(version));
    const actions = fsScriptAdminNode('div', { class: 'actions' }, [previewButton, restoreButton]);
    container.append(fsScriptAdminNode('article', { class: 'fs-version-row' }, [head, note, by, actions]));
  }
}

window.FsScriptAdmin = {
  node: fsScriptAdminNode,
  listEditor: fsListEditor,
  versionHistory: fsVersionHistoryList
};

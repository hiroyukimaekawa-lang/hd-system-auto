export async function setAssignUsers(page, settings = {}) {
  const accessible = page.locator('select[name="staff_id_accessible[]"]');
  const unaccessible = page.locator('select[name="staff_id_unaccessible[]"]');
  if (!await accessible.count() || !await unaccessible.count()) throw new Error('アサインユーザーの選択欄が見つかりません');

  const mode = settings.mode || 'listed';
  const requestedUsers = Array.isArray(settings.users) ? settings.users.map(String) : [];
  if (!['all', 'listed'].includes(mode)) throw new Error(`アサインユーザーのmodeが不正です: ${mode}`);
  if (mode === 'listed' && !requestedUsers.length) throw new Error('assignUsers.usersが空です');

  const normalize = (value) => String(value || '').replace(/\s+/g, '');
  const requested = new Set(requestedUsers.map(normalize));
  const readOptions = async (select) => select.locator('option').evaluateAll((options) =>
    options.map((option) => ({ value: option.value, text: option.text.trim() })).filter((option) => option.text));
  const availableBefore = [...await readOptions(accessible), ...await readOptions(unaccessible)];
  const missing = mode === 'listed'
    ? requestedUsers.filter((name) => !availableBefore.some((option) => normalize(option.text) === normalize(name)))
    : [];
  if (missing.length) throw new Error(`指定したアサインユーザーが画面にいません: ${missing.join('、')}`);

  const move = async (source, values, direction) => {
    if (!values.length) return;
    const wanted = new Set(values.map(String));
    const selector = await source.getAttribute('id').then((id) => `#${id}`);
    // Some Comdesk transfer widgets only move a subset per click (or reset the
    // selection mid-transfer), which previously left just one user accessible.
    // Re-select the still-present targets and click until all of them have moved.
    for (let attempt = 0; attempt < 4; attempt++) {
      const present = (await readOptions(source)).filter((option) => wanted.has(String(option.value)));
      if (!present.length) return;
      const before = await source.locator('option').count();
      await source.selectOption(present.map((option) => option.value));
      await page.locator(`#AccessableUser a:has(.fa-caret-${direction})`).click();
      await page.waitForFunction(
        ({ selector, count }) => (document.querySelector(selector)?.options.length ?? 0) < count,
        { selector, count: before }
      ).catch(() => {});
    }
    const stuck = (await readOptions(source)).filter((option) => wanted.has(String(option.value)));
    if (stuck.length) throw new Error(`アサインユーザーの移動が完了しませんでした（残り${stuck.length}人）`);
  };

  if (mode === 'all') {
    await move(unaccessible, (await readOptions(unaccessible)).map((option) => option.value), 'left');
  } else {
    const remove = (await readOptions(accessible)).filter((option) => !requested.has(normalize(option.text))).map((option) => option.value);
    await move(accessible, remove, 'right');
    const add = (await readOptions(unaccessible)).filter((option) => requested.has(normalize(option.text))).map((option) => option.value);
    await move(unaccessible, add, 'left');
  }

  const finalAccessible = await readOptions(accessible);
  await accessible.selectOption(finalAccessible.map((option) => option.value));
  const result = finalAccessible.map((option) => option.text);
  if (!result.length) throw new Error('アサインユーザーが0人になっています');
  console.log(`アサインユーザー: ${result.join('、')}`);
  return result;
}

export async function assertAssignUsersBeforeSubmit(page, expectedUsers, settings = {}) {
  const actual = await page.evaluate(() => {
    const accessible = document.querySelector('select[name="staff_id_accessible[]"]');
    const unaccessible = document.querySelector('select[name="staff_id_unaccessible[]"]');
    return {
      selected: accessible ? [...accessible.selectedOptions].map((option) => option.text.trim()).filter(Boolean) : [],
      accessible: accessible ? [...accessible.options].map((option) => option.text.trim()).filter(Boolean) : [],
      unaccessible: unaccessible ? [...unaccessible.options].map((option) => option.text.trim()).filter(Boolean) : []
    };
  });
  const normalize = (value) => String(value || '').replace(/\s+/g, '');
  const selected = new Set(actual.selected.map(normalize));
  const missing = expectedUsers.filter((name) => !selected.has(normalize(name)));
  if (missing.length) throw new Error(`登録直前にアサインユーザーの選択が外れました: ${missing.join('、')}`);
  if ((settings.mode || 'listed') === 'all' && (actual.unaccessible.length || actual.selected.length !== actual.accessible.length)) {
    throw new Error(`全ユーザー選択を確認できません: 選択=${actual.selected.length} アクセス可=${actual.accessible.length} アクセス不可=${actual.unaccessible.length}`);
  }
}

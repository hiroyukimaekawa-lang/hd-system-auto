export function parseReviewCounts(text) {
  const value = String(text || '').replace(/\s+/g, ' ');
  return {
    newRows: Number(value.match(/新規件数\s*[:：]?\s*(\d+)件/)?.[1] || 0),
    duplicates: Number(value.match(/重複\s*\(\s*(\d+)件\s*\)/)?.[1] || 0),
    blocked: Number(value.match(/禁止番号\s*\(\s*(\d+)件\s*\)/)?.[1] || 0)
  };
}

export function isReviewCountConsistent(expectedRows, { newRows, duplicates, blocked }) {
  // A prohibited number can also appear in the duplicate tab. Therefore the
  // number of excluded source rows is between max(duplicates, blocked) and
  // duplicates + blocked, depending on how much the two sets overlap.
  const minimum = newRows + Math.max(duplicates, blocked);
  const maximum = newRows + duplicates + blocked;
  return expectedRows >= minimum && expectedRows <= maximum;
}

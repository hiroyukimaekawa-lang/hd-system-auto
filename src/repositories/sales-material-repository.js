// 商談資料の保存先を差し替えられるようにするための共通インターフェース。
// 現在は LocalSqliteSalesMaterialRepository のみ。将来 CloudSalesMaterialRepository を追加する。
export class SalesMaterialRepository {
  list() { throw new Error('list は実装されていません'); }
  get() { throw new Error('get は実装されていません'); }
  save() { throw new Error('save は実装されていません'); }
  setActive() { throw new Error('setActive は実装されていません'); }
  importAll() { throw new Error('importAll は実装されていません'); }
}

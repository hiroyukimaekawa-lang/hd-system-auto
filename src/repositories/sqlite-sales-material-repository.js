import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { SalesMaterialRepository } from './sales-material-repository.js';
import { normalizeMaterial, selectPhaseMaterials, visibleTo, phaseTagsFor } from '../sales-materials.js';

const now = () => new Date().toISOString();
const parse = (value, fallback = []) => { try { return JSON.parse(value); } catch { return fallback; } };
const toMaterial = row => ({
  id:row.id, title:row.title, sourceTitle:row.source_title || '', description:row.description || '',
  category:row.category, product:row.product, sourceType:row.source_type, url:row.url,
  phaseTags:parse(row.phase_tags), visibility:row.visibility, customerShareable:Boolean(row.customer_shareable),
  sortOrder:row.sort_order, active:Boolean(row.active), companyId:row.company_id || '',
  createdBy:row.created_by || '', updatedBy:row.updated_by || '', version:row.version,
  createdAt:row.created_at, updatedAt:row.updated_at
});

export class LocalSqliteSalesMaterialRepository extends SalesMaterialRepository {
  constructor(database = 'state/sales-assist.sqlite') {
    super();
    if (typeof database === 'string') {
      fs.mkdirSync(path.dirname(database), { recursive:true });
      this.db = new Database(database);
      this.owned = true;
    } else {
      this.db = database;
      this.owned = false;
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS sales_materials(
      id TEXT PRIMARY KEY, title TEXT, source_title TEXT DEFAULT '', description TEXT DEFAULT '',
      category TEXT, product TEXT, source_type TEXT, url TEXT, phase_tags TEXT DEFAULT '[]',
      visibility TEXT DEFAULT 'fs_internal', customer_shareable INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 999,
      active INTEGER DEFAULT 1, company_id TEXT DEFAULT '', created_by TEXT DEFAULT '', updated_by TEXT DEFAULT '',
      version INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT)`);
  }
  list({ category, product, active, viewer = 'fs', keyword } = {}) {
    const rows = this.db.prepare('SELECT * FROM sales_materials ORDER BY sort_order, id').all().map(toMaterial);
    const text = String(keyword || '').trim();
    return rows.filter(item =>
      visibleTo(item, viewer)
      && (!category || item.category === category)
      && (!product || item.product === product)
      && (active === undefined || item.active === active)
      && (!text || `${item.title}${item.sourceTitle}${item.description}`.includes(text)));
  }
  get(id, { viewer = 'fs' } = {}) {
    const row = this.db.prepare('SELECT * FROM sales_materials WHERE id=?').get(id);
    if (!row) return null;
    const material = toMaterial(row);
    return visibleTo(material, viewer) ? material : null;
  }
  save(input) {
    const material = normalizeMaterial(input);
    const existing = this.db.prepare('SELECT created_at,version FROM sales_materials WHERE id=?').get(material.id);
    const timestamp = now();
    this.db.prepare(`INSERT INTO sales_materials(id,title,source_title,description,category,product,source_type,url,phase_tags,visibility,customer_shareable,sort_order,active,company_id,created_by,updated_by,version,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,source_title=excluded.source_title,description=excluded.description,category=excluded.category,product=excluded.product,source_type=excluded.source_type,url=excluded.url,phase_tags=excluded.phase_tags,visibility=excluded.visibility,customer_shareable=excluded.customer_shareable,sort_order=excluded.sort_order,active=excluded.active,company_id=excluded.company_id,updated_by=excluded.updated_by,version=sales_materials.version+1,updated_at=excluded.updated_at`)
      .run(material.id,material.title,material.sourceTitle,material.description,material.category,material.product,material.sourceType,material.url,JSON.stringify(material.phaseTags),material.visibility,material.customerShareable?1:0,material.sortOrder,material.active?1:0,material.companyId,material.createdBy,material.updatedBy,(existing?.version||0)+1,existing?.created_at||timestamp,timestamp);
    return this.get(material.id, { viewer:'admin' });
  }
  // 削除は行わず active の切り替えで停止する
  setActive(id, active, actor = '') {
    if (!this.db.prepare('SELECT id FROM sales_materials WHERE id=?').get(id)) return null;
    this.db.prepare('UPDATE sales_materials SET active=?,updated_by=?,version=version+1,updated_at=? WHERE id=?').run(active ? 1 : 0, String(actor || ''), now(), id);
    return this.get(id, { viewer:'admin' });
  }
  importAll(materials = [], { actor = '' } = {}) {
    const list = Array.isArray(materials) ? materials : [];
    const result = { imported:0, errors:[] };
    this.db.transaction(() => {
      for (const item of list) {
        try { this.save({ ...item, updatedBy:actor }); result.imported += 1; }
        catch (error) { result.errors.push(`${item?.id || '(ID未設定)'}：${error.message}`); }
      }
    })();
    return result;
  }
  phaseMaterials({ phaseId, phaseTagMap = {}, products = '', viewer = 'fs', limit = 4 } = {}) {
    const tags = phaseTagsFor(phaseId, phaseTagMap);
    return { tags, materials:selectPhaseMaterials(this.list({ viewer, active:true }), { tags, products, limit }) };
  }
  close() { if (this.owned) this.db.close(); }
}

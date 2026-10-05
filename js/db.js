const DB_NAME = 'ExpenseTracker';
const DB_VERSION = 1;

class ExpenseDB {
  constructor() { this._db = null; }

  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => this._upgrade(e.target.result, e.oldVersion);
      req.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
      req.onerror = e => reject(e.target.error);
    });
  }

  _upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      const exp = db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
      exp.createIndex('date', 'date');
      exp.createIndex('month', 'month');
      exp.createIndex('category', 'category');

      db.createObjectStore('categories', { keyPath: 'id' });
      db.createObjectStore('budgets', { keyPath: 'id' });
      db.createObjectStore('settings', { keyPath: 'key' });

      const mr = db.createObjectStore('merchant_rules', { keyPath: 'id', autoIncrement: true });
      mr.createIndex('keyword', 'keyword');
    }
  }

  async _op(stores, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      tx.onerror = e => reject(e.target.error);
      const result = fn(tx);
      if (result && typeof result.then === 'function') {
        result.then(resolve).catch(reject);
      } else {
        tx.oncomplete = () => resolve(result);
      }
    });
  }

  async getAll(store) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  async get(store, key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  async add(store, data) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).add(data);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  async put(store, data) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).put(data);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  async delete(store, key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    });
  }

  async getByIndex(store, indexName, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).index(indexName).getAll(value);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  async getRange(store, indexName, lower, upper) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const range = IDBKeyRange.bound(lower, upper);
      const req = db.transaction(store, 'readonly').objectStore(store).index(indexName).getAll(range);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  async clearStore(store) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).clear();
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    });
  }

  async getSetting(key, defaultValue = null) {
    const row = await this.get('settings', key);
    return row ? row.value : defaultValue;
  }

  async setSetting(key, value) {
    return this.put('settings', { key, value });
  }
}

export const db = new ExpenseDB();

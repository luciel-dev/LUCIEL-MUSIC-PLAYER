/* Luciel storage: settings in localStorage, library track blobs + saved playlists in IndexedDB (best effort). */
(function (global) {
  'use strict';
  const KEY = 'luciel.settings.v1', OLD_KEY = 'aeroamp.settings.v1';
  const DB = 'luciel', STORE = 'tracks';

  const Settings = {
    load() {
      try { return JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY)) || {}; } catch (e) { return {}; }
    },
    save(obj) {
      try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (e) { /* private mode / quota */ }
    },
  };

  let dbp = null;
  function db() {
    if (!('indexedDB' in global)) return Promise.reject(new Error('no idb'));
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open(DB, 3);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
          if (!d.objectStoreNames.contains('playlists')) d.createObjectStore('playlists', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('packs')) d.createObjectStore('packs', { keyPath: 'id' });   // visual packs (browser build)
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return dbp;
  }
  function tx(mode, fn, store = STORE) {
    return db().then((d) => new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }
  const mk = (store) => ({
    put(rec) { return tx('readwrite', (s) => s.put(rec), store); },
    remove(id) { return tx('readwrite', (s) => s.delete(id), store); },
    clear() { return tx('readwrite', (s) => s.clear(), store); },
    all() { return tx('readonly', (s) => s.getAll(), store); },
    get(id) { return tx('readonly', (s) => s.get(id), store); },
  });
  const Tracks = mk(STORE);
  const Playlists = mk('playlists');
  const Packs = mk('packs');
  global.AeroStore = { Settings, Tracks, Playlists, Packs };
})(window);

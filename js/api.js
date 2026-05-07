// ============================================
// js/api.js
// Modul komunikasi ke Google Apps Script API
// Digunakan oleh semua halaman di GitHub Pages
// ============================================

// ⚠️ GANTI dengan URL deployment GAS Anda
// Dapatkan dari: GAS Editor → Deploy → Manage Deployments → URL
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbx9qIISf9ePbSjCkaSZYUtEI_WyHg9vUjE5kOAdPNVMSiCOj1_4o7rcbTEd3FOjwFh6/exec';

// ============================================
// CACHE LOKAL - kurangi pemanggilan ke GAS
// ============================================
const Cache = {
  _store: {},
  TTL: 60000, // 60 detik

  set(key, data) {
    this._store[key] = { data, ts: Date.now() };
  },

  get(key) {
    const entry = this._store[key];
    if (!entry) return null;
    if (Date.now() - entry.ts > this.TTL) { delete this._store[key]; return null; }
    return entry.data;
  },

  clear(key) {
    if (key) delete this._store[key];
    else this._store = {};
  }
};

/**
 * Kirim request ke GAS API
 * @param {string} action - nama action yang dipanggil
 * @param {object} payload - data tambahan
 * @param {string|null} sessionId - session token (null jika belum login)
 */
async function callAPI(action, payload = {}, sessionId = null) {
  const body = { action, payload };
  if (sessionId) body.sessionId = sessionId;

  try {
    const response = await fetch(GAS_API_URL, {
      method: 'POST',
      // GAS tidak support preflight CORS, gunakan no-cors untuk non-JSON
      // Tapi kita butuh response, jadi gunakan mode 'cors' dengan redirect
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' }, // ← PENTING: GAS butuh text/plain
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error('HTTP error: ' + response.status);
    }

    const data = await response.json();
    return data;

  } catch (err) {
    console.error('API Error [' + action + ']:', err);
    return { success: false, message: 'Gagal menghubungi server: ' + err.message };
  }
}

// ============================================
// AUTH API
// ============================================

const Auth = {
  async login(username, password) {
    return await callAPI('login', { username, password });
  },

  async logout() {
    const sessionId = Session.get()?.sessionId;
    const result = await callAPI('logout', {}, sessionId);
    Session.clear();
    return result;
  },

  async validate() {
    const session = Session.get();
    if (!session) return { valid: false };
    return await callAPI('validateSession', {}, session.sessionId);
  }
};

// ============================================
// SESSION MANAGER
// ============================================

const Session = {
  KEY: 'morbrief_session',

  save(data) {
    localStorage.setItem(this.KEY, JSON.stringify({
      ...data,
      savedAt: Date.now()
    }));
  },

  get() {
    const raw = localStorage.getItem(this.KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Cek expired di client (1 jam)
    if (Date.now() - data.savedAt > 3600000) {
      this.clear();
      return null;
    }
    return data;
  },

  clear() {
    localStorage.removeItem(this.KEY);
  },

  isLoggedIn() {
    return this.get() !== null;
  },

  getRole() {
    return this.get()?.peran || null;
  }
};

// ============================================
// DOCUMENT API
// ============================================

const Documents = {
  async getAll(filters = {}) {
    const sessionId = Session.get()?.sessionId;
    // Gunakan cache hanya jika tidak ada filter aktif (tampilan awal)
    const hasFilter = filters.search || filters.kategori || filters.sortBy;
    const cacheKey = 'docs_' + JSON.stringify(filters);
    if (!hasFilter) {
      const cached = Cache.get(cacheKey);
      if (cached) return cached;
    }
    const result = await callAPI('getDocuments', { filters }, sessionId);
    if (result.success && !hasFilter) Cache.set(cacheKey, result);
    return result;
  },

  async upload(docData) {
    const sessionId = Session.get()?.sessionId;
    Cache.clear(); // invalidate cache
    return await callAPI('uploadDocument', { docData }, sessionId);
  },

  async update(documentId, updateData) {
    const sessionId = Session.get()?.sessionId;
    return await callAPI('updateDocument', { documentId, updateData }, sessionId);
  },

  async delete(documentId) {
    const sessionId = Session.get()?.sessionId;
    Cache.clear(); // invalidate cache
    return await callAPI('deleteDocument', { documentId }, sessionId);
  },

  async download(documentId) {
    const sessionId = Session.get()?.sessionId;
    return await callAPI('downloadDocument', { documentId }, sessionId);
  }
};

// ============================================
// USER API (ADMIN ONLY)
// ============================================

const Users = {
  async getAll() {
    const sessionId = Session.get()?.sessionId;
    return await callAPI('getUsers', {}, sessionId);
  },

  async add(username, password, peran, namaLengkap) {
    const sessionId = Session.get()?.sessionId;
    return await callAPI('addUser', { username, password, peran, namaLengkap }, sessionId);
  },

  async delete(username) {
    const sessionId = Session.get()?.sessionId;
    return await callAPI('deleteUser', { username }, sessionId);
  }
};

// ============================================
// GUARD: Redirect ke login jika belum login
// Panggil di awal setiap halaman yang butuh auth
// ============================================

function requireAuth(allowedRoles = null) {
  const session = Session.get();
  if (!session) {
    window.location.href = '/morbrief/index.html';
    return false;
  }
  if (allowedRoles && !allowedRoles.includes(session.peran)) {
    window.location.href = '/morbrief/dashboard.html';
    return false;
  }
  return true;
}

/**
 * Redirect ke dashboard jika sudah login (untuk halaman login)
 */
function redirectIfLoggedIn() {
  if (Session.isLoggedIn()) {
    window.location.href = '/morbrief/dashboard.html';
  }
}

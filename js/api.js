// ============================================
// js/api.js
// Modul komunikasi ke Express Server / Google Apps Script API
// Digunakan oleh seluruh halaman Morbrief
// ============================================

// Secara default, arahkan ke backend server Express lokal jika berjalan pada platform ini,
// atau timpa dengan URL deployment Google Apps Script Anda jika dideploy mandiri di GAS.
const GAS_API_URL = '/api';

// ============================================
// CACHE LOKAL - kurangi pemanggilan ke REST/GAS
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
 * Kirim request ke API Server
 * @param {string} action - nama action yang dipanggil
 * @param {object} payload - data tambahan
 * @param {string|null} sessionId - session token
 */
async function callAPI(action, payload = {}, sessionId = null) {
  const isExternalGAS = typeof GAS_API_URL !== 'undefined' && GAS_API_URL && (GAS_API_URL.startsWith('http://') || GAS_API_URL.startsWith('https://'));
  
  let url;
  let body;
  
  if (isExternalGAS) {
    url = GAS_API_URL;
    // Standard Google Apps Script doPost JSON format
    let gasPayload = { ...payload };
    
    // Khusus untuk uploadDocumentFile di GAS agar mendatangkan parameter yang sesuai dengan Code_Hybrid.gs
    if (action === 'uploadDocumentFile') {
      gasPayload = {
        fileName: payload.fileName,
        fileData: payload.fileData,
        judul: payload.judul,
        kategori: payload.kategori,
        tag: payload.tag
      };
    }
    
    body = {
      action: action,
      payload: gasPayload,
      sessionId: sessionId
    };
  } else {
    // Hubungkan aksi GAS legacy langsung ke RESTful endpoints Node.js Express kita
    url = '/api/' + action;
    body = {};

    if (action === 'getDocuments') {
      body = { filters: payload.filters || {}, sessionId };
    } else if (action === 'uploadDocument') {
      body = { docData: payload.docData, sessionId };
    } else if (action === 'uploadDocumentFile') {
      // Konversi aksi fileupload GAS legacy menjadi format standard REST kami
      url = '/api/uploadDocument';
      body = {
        docData: {
          judul: payload.judul,
          kategori: payload.kategori,
          tag: payload.tag,
          fileName: payload.fileName,
          fileContentBase64: payload.fileData,
          fileMimeType: 'application/pdf',
          fileSize: Math.round((payload.fileData || '').length * 0.75)
        },
        sessionId
      };
    } else if (action === 'updateDocument') {
      body = { documentId: payload.documentId, updateData: payload.updateData, sessionId };
    } else if (action === 'deleteDocument') {
      body = { documentId: payload.documentId, sessionId };
    } else if (action === 'getUsers') {
      body = { sessionId };
    } else if (action === 'addUser') {
      body = {
        username: payload.username,
        password: payload.password,
        peran: payload.peran,
        namaLengkap: payload.namaLengkap,
        sessionId
      };
    } else if (action === 'deleteUser') {
      body = { username: payload.username, sessionId };
    } else {
      body = { ...payload, sessionId };
    }
  }

  try {
    const headers = { 
      'Content-Type': 'application/json'
    };
    if (!isExternalGAS) {
      headers['x-session-id'] = sessionId || '';
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error('Gagal memproses permintaan HTTP: ' + response.status);
    }

    const data = await response.json();
    return data;

  } catch (err) {
    console.error('API Error [' + action + ']:', err);
    return { success: false, message: 'Gagal menghubungi server Morbrief: ' + err.message };
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
    // Masa aktif sesi: 1 jam kedaluwarsa di klien
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
    Cache.clear();
    return await callAPI('uploadDocument', { docData }, sessionId);
  },

  async uploadFile(fileName, fileData, judul, kategori, tag) {
    const sessionId = Session.get()?.sessionId;
    Cache.clear();
    return await callAPI('uploadDocumentFile', {
      fileName, fileData, judul, kategori, tag
    }, sessionId);
  },

  async update(documentId, updateData) {
    const sessionId = Session.get()?.sessionId;
    return await callAPI('updateDocument', { documentId, updateData }, sessionId);
  },

  async delete(documentId) {
    const sessionId = Session.get()?.sessionId;
    Cache.clear();
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
// GUARD: Otomatisasi rute terproteksi
// ============================================

function requireAuth(allowedRoles = null) {
  const session = Session.get();
  if (!session) {
    window.location.href = '/index.html';
    return false;
  }
  if (allowedRoles && !allowedRoles.includes(session.peran)) {
    window.location.href = '/morbrief/dashboard.html';
    return false;
  }
  return true;
}

function redirectIfLoggedIn() {
  if (Session.isLoggedIn()) {
    window.location.href = '/morbrief/dashboard.html';
  }
}

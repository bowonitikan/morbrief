// ============================================
// SISTEM MANAJEMEN ARSIP PDF
// Code.gs - VERSI HYBRID (GitHub Pages + GAS API)
//
// PERUBAHAN UTAMA DARI VERSI SEBELUMNYA:
// 1. doGet() → serve JSON API response (bukan HTML)
// 2. doPost() → terima request dari GitHub Pages
// 3. Semua function return JSON dengan CORS headers
// 4. Session token via header/body (bukan cookie)
// ============================================

const CONFIG = {
  spreadsheetId: 'YOUR_SPREADSHEET_ID_HERE',
  folderId: 'YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE',
  geminiApiKey: 'YOUR_GEMINI_API_KEY_HERE',
  sessionTimeout: 3600000, // 1 jam
  allowedOrigin: 'https://bowonitikan.github.io', // ← GitHub Pages URL
};

// ============================================
// CORS & ROUTER UTAMA
// ============================================

/**
 * Handle GET requests - digunakan untuk health check
 */
function doGet(e) {
  return buildResponse({ status: 'ok', message: 'Arsip API is running' });
}

/**
 * Handle POST requests - semua action dari frontend
 * Format body: { action: 'login', payload: {...} }
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const payload = body.payload || {};
    const sessionId = body.sessionId || null;

    let result;

    switch (action) {
      case 'login':
        result = loginUser(payload.username, payload.password);
        break;
      case 'logout':
        result = logoutUser(sessionId);
        break;
      case 'getDocuments':
        result = getDocuments(sessionId, payload.filters || {});
        break;
      case 'uploadDocument':
        result = uploadDocument(sessionId, payload.docData);
        break;
      case 'updateDocument':
        result = updateDocument(sessionId, payload.documentId, payload.updateData);
        break;
      case 'deleteDocument':
        result = deleteDocument(sessionId, payload.documentId);
        break;
      case 'downloadDocument':
        result = downloadDocument(sessionId, payload.documentId);
        break;
      case 'getUsers':
        result = getUsers(sessionId);
        break;
      case 'addUser':
        result = addUser(sessionId, payload.username, payload.password, payload.peran, payload.namaLengkap);
        break;
      case 'deleteUser':
        result = deleteUser(sessionId, payload.username);
        break;
      case 'validateSession':
        result = validateSession(sessionId);
        break;
      default:
        result = { success: false, message: 'Action tidak dikenal: ' + action };
    }

    return buildResponse(result);

  } catch (err) {
    return buildResponse({
      success: false,
      message: 'Server error: ' + err.toString()
    });
  }
}

/**
 * Build JSON response dengan CORS headers
 * GAS tidak support custom headers secara penuh,
 * tapi kita set Content-Type dan wrap di JSONP jika perlu
 */
function buildResponse(data) {
  const output = ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ============================================
// SETUP & INISIALISASI
// ============================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📋 Arsip')
    .addItem('Setup Database', 'setupDatabase')
    .addItem('Buat Admin Pertama', 'createAdminUser')
    .addItem('Lihat API URL', 'showApiUrl')
    .addToUi();
}

/**
 * Tampilkan URL API untuk disalin ke config frontend
 */
function showApiUrl() {
  const url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert(
    '🔗 API URL untuk Frontend:\n\n' + url +
    '\n\nSalin URL ini ke file js/config.js di GitHub repo.'
  );
}

/**
 * Setup database - buat sheets jika belum ada
 */
function setupDatabase() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);

  if (!ss.getSheetByName('Dokumen')) {
    const s = ss.insertSheet('Dokumen');
    s.appendRow(['ID','Judul','Kategori','Tag','Tanggal Upload','Uploader','URL Drive','Ringkasan AI','Status']);
    s.setFrozenRows(1);
    formatHeader(s);
  }

  if (!ss.getSheetByName('Pengguna')) {
    const s = ss.insertSheet('Pengguna');
    s.appendRow(['Username','Password Hash','Peran','Nama Lengkap','Status','Dibuat','Terakhir Login']);
    s.setFrozenRows(1);
    formatHeader(s);
  }

  SpreadsheetApp.getUi().alert('✅ Database siap!');
}

function formatHeader(sheet) {
  const r = sheet.getRange(1, 1, 1, sheet.getLastColumn());
  r.setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
}

function createAdminUser() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Username admin baru:');
  if (res.getSelectedButton() !== ui.Button.OK) return;

  const username = res.getResponseText();
  const password = Utilities.getUuid().split('-')[0]; // password pendek
  const hash = hashPassword(password);

  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  ss.getSheetByName('Pengguna').appendRow([
    username, hash, 'admin', 'Administrator', 'aktif', new Date(), ''
  ]);

  ui.alert('✅ Admin dibuat!\nUsername: ' + username + '\nPassword: ' + password);
}

// ============================================
// AUTENTIKASI
// ============================================

function hashPassword(password) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function loginUser(username, password) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const data = ss.getSheetByName('Pengguna')
    .getRange(2, 1, ss.getSheetByName('Pengguna').getLastRow(), 7).getValues();

  const hash = hashPassword(password);

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === username && data[i][1] === hash && data[i][4] === 'aktif') {
      ss.getSheetByName('Pengguna').getRange(i + 2, 7).setValue(new Date());

      const sessionId = Utilities.getUuid();
      const session = {
        sessionId, username,
        peran: data[i][2],
        namaLengkap: data[i][3],
        expiresAt: Date.now() + CONFIG.sessionTimeout
      };

      CacheService.getScriptCache().put(sessionId, JSON.stringify(session), CONFIG.sessionTimeout / 1000);

      return { success: true, sessionId, username, peran: data[i][2], namaLengkap: data[i][3] };
    }
  }
  return { success: false, message: 'Username atau password salah' };
}

function validateSession(sessionId) {
  if (!sessionId) return { valid: false };
  const raw = CacheService.getScriptCache().get(sessionId);
  if (!raw) return { valid: false };

  const session = JSON.parse(raw);
  if (Date.now() > session.expiresAt) {
    CacheService.getScriptCache().remove(sessionId);
    return { valid: false };
  }

  // Refresh expiry
  CacheService.getScriptCache().put(sessionId, raw, CONFIG.sessionTimeout / 1000);

  return { valid: true, username: session.username, peran: session.peran, namaLengkap: session.namaLengkap };
}

function logoutUser(sessionId) {
  if (sessionId) CacheService.getScriptCache().remove(sessionId);
  return { success: true };
}

// ============================================
// MANAJEMEN DOKUMEN
// ============================================

function getDocuments(sessionId, filters) {
  const v = validateSession(sessionId);
  if (!v.valid) return { success: false, message: 'Sesi tidak valid' };

  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName('Dokumen');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, documents: [], total: 0 };

  const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();

  let docs = data
    .filter(r => r[0]) // skip baris kosong
    .map(r => ({
      id: r[0], judul: r[1], kategori: r[2], tag: r[3],
      tanggalUpload: r[4] ? r[4].toString() : '',
      uploader: r[5], fileUrl: r[6], ringkasan: r[7], status: r[8]
    }));

  // Filter peran
  if (v.peran === 'operator') {
    docs = docs.filter(d => d.uploader === v.username);
  }

  // Filter kategori
  if (filters.kategori) docs = docs.filter(d => d.kategori === filters.kategori);

  // Filter search
  if (filters.search) {
    const q = filters.search.toLowerCase();
    docs = docs.filter(d =>
      d.judul.toLowerCase().includes(q) ||
      (d.ringkasan || '').toLowerCase().includes(q) ||
      (d.tag || '').toLowerCase().includes(q)
    );
  }

  // Sorting
  if (filters.sortBy) {
    const asc = filters.ascending !== false;
    docs.sort((a, b) => {
      const av = String(a[filters.sortBy] || '').toLowerCase();
      const bv = String(b[filters.sortBy] || '').toLowerCase();
      return asc ? av.localeCompare(bv, 'id') : bv.localeCompare(av, 'id');
    });
  }

  return { success: true, documents: docs, total: docs.length };
}

function uploadDocument(sessionId, docData) {
  const v = validateSession(sessionId);
  if (!v.valid) return { success: false, message: 'Sesi tidak valid' };
  if (!['admin', 'operator'].includes(v.peran)) return { success: false, message: 'Akses ditolak' };

  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const id = Utilities.getUuid();

  ss.getSheetByName('Dokumen').appendRow([
    id, docData.judul, docData.kategori, docData.tag || '',
    new Date(), v.username, docData.fileUrl, 'Memproses ringkasan...', 'aktif'
  ]);

  // Generate AI summary async
  try { generateSummary(id, docData.fileUrl); } catch(e) {}

  return { success: true, documentId: id, message: 'Dokumen berhasil diunggah' };
}

function generateSummary(documentId, fileUrl) {
  const fileId = (fileUrl.match(/\/d\/([^\/]+)\//) || [])[1];
  if (!fileId) return;

  const blob = DriveApp.getFileById(fileId).getBlob();
  const b64 = Utilities.base64Encode(blob.getBytes());

  const res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + CONFIG.geminiApiKey,
    {
      method: 'post', contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ parts: [
          { text: 'Buatkan ringkasan 3-5 kalimat dari dokumen PDF ini dalam Bahasa Indonesia. Fokus pada poin utama.' },
          { inlineData: { mimeType: 'application/pdf', data: b64 } }
        ]}]
      })
    }
  );

  const result = JSON.parse(res.getContentText());
  const summary = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!summary) return;

  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName('Dokumen');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === documentId) {
      sheet.getRange(i + 2, 8).setValue(summary);
      break;
    }
  }
}

function updateDocument(sessionId, documentId, updateData) {
  const v = validateSession(sessionId);
  if (!v.valid) return { success: false, message: 'Sesi tidak valid' };

  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName('Dokumen');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === documentId) {
      if (v.peran === 'operator' && data[i][5] !== v.username)
        return { success: false, message: 'Hanya bisa edit dokumen sendiri' };

      const row = i + 2;
      if (updateData.judul) sheet.getRange(row, 2).setValue(updateData.judul);
      if (updateData.kategori) sheet.getRange(row, 3).setValue(updateData.kategori);
      if (updateData.tag !== undefined) sheet.getRange(row, 4).setValue(updateData.tag);
      return { success: true, message: 'Dokumen diperbarui' };
    }
  }
  return { success: false, message: 'Dokumen tidak ditemukan' };
}

function deleteDocument(sessionId, documentId) {
  const v = validateSession(sessionId);
  if (!v.valid || v.peran !== 'admin') return { success: false, message: 'Akses ditolak' };

  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName('Dokumen');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === documentId) {
      sheet.deleteRow(i + 2);
      return { success: true, message: 'Dokumen dihapus' };
    }
  }
  return { success: false, message: 'Dokumen tidak ditemukan' };
}

function downloadDocument(sessionId, documentId) {
  const v = validateSession(sessionId);
  if (!v.valid) return { success: false, message: 'Sesi tidak valid' };

  const docs = getDocuments(sessionId, {});
  if (!docs.success) return docs;

  const doc = docs.documents.find(d => d.id === documentId);
  if (!doc) return { success: false, message: 'Tidak ditemukan' };

  return { success: true, fileUrl: doc.fileUrl };
}

// ============================================
// MANAJEMEN USER (ADMIN)
// ============================================

function getUsers(sessionId) {
  const v = validateSession(sessionId);
  if (!v.valid || v.peran !== 'admin') return { success: false, message: 'Akses ditolak' };

  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName('Pengguna');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();

  return {
    success: true,
    users: data.map(r => ({
      username: r[0], peran: r[2], namaLengkap: r[3],
      status: r[4], dibuat: r[5]?.toString() || '', lastLogin: r[6]?.toString() || ''
    }))
  };
}

function addUser(sessionId, username, password, peran, namaLengkap) {
  const v = validateSession(sessionId);
  if (!v.valid || v.peran !== 'admin') return { success: false, message: 'Akses ditolak' };
  if (!['admin', 'era', 'operator'].includes(peran)) return { success: false, message: 'Peran tidak valid' };

  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName('Pengguna');
  const existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();

  if (existing.some(r => r[0] === username))
    return { success: false, message: 'Username sudah ada' };

  const finalPassword = password || Utilities.getUuid().split('-')[0];
  sheet.appendRow([username, hashPassword(finalPassword), peran, namaLengkap, 'aktif', new Date(), '']);

  return { success: true, message: 'Pengguna ditambahkan', username, password: finalPassword };
}

function deleteUser(sessionId, username) {
  const v = validateSession(sessionId);
  if (!v.valid || v.peran !== 'admin') return { success: false, message: 'Akses ditolak' };

  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName('Pengguna');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === username) {
      sheet.deleteRow(i + 2);
      return { success: true, message: 'Pengguna dihapus' };
    }
  }
  return { success: false, message: 'Pengguna tidak ditemukan' };
}

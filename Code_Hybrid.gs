// ============================================
// DEBUG FUNCTIONS
// Jalankan dari GAS Editor → pilih function → klik ▶ Run
// Lihat hasil di: Execution Log (bawah layar)
// ============================================

function debugStep1_Sheets() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName('Dokumen');
  if (!sheet) { Logger.log('❌ Sheet "Dokumen" tidak ditemukan. Jalankan setupDatabase() dulu.'); return; }

  const lastRow = sheet.getLastRow();
  Logger.log('✅ Sheets OK — Total dokumen: ' + (lastRow - 1));

  if (lastRow < 2) { Logger.log('Sheet kosong, belum ada dokumen.'); return; }

  const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  data.forEach((row, i) => {
    if (!row[0]) return;
    Logger.log('---');
    Logger.log('[' + (i+1) + '] Judul    : ' + row[1]);
    Logger.log('     ID       : ' + row[0]);
    Logger.log('     URL      : ' + (row[6] || '(kosong)'));
    Logger.log('     Ringkasan: ' + (row[7] || '(kosong)').toString().substring(0, 80));
  });
  Logger.log('=== Step 1 selesai ===');
}

function debugStep2_Drive() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName('Dokumen');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues();
  const doc = data.find(row => row[0] && row[6]);

  if (!doc) { Logger.log('❌ Tidak ada dokumen dengan URL Drive di Sheets.'); return; }

  const fileUrl = doc[6].toString();
  Logger.log('Dokumen  : ' + doc[1]);
  Logger.log('URL asli : ' + fileUrl);

  const match = fileUrl.match(/\/d\/([^\/\?]+)/);
  if (!match) {
    Logger.log('❌ Format URL tidak valid. Harus mengandung /d/FILE_ID/');
    Logger.log('Contoh benar: https://drive.google.com/file/d/1abc.../view');
    return;
  }

  const fileId = match[1];
  Logger.log('File ID  : ' + fileId);

  try {
    const file = DriveApp.getFileById(fileId);
    Logger.log('✅ File ditemukan!');
    Logger.log('Nama     : ' + file.getName());
    Logger.log('Ukuran   : ' + Math.round(file.getSize() / 1024) + ' KB');
    Logger.log('Tipe     : ' + file.getMimeType());
    Logger.log('Sharing  : ' + file.getSharingAccess());
    Logger.log('=== Step 2 selesai ===');
  } catch(e) {
    Logger.log('❌ Tidak bisa akses file Drive: ' + e.toString());
    Logger.log('Kemungkinan penyebab:');
    Logger.log('  1. File belum di-share "Anyone with the link"');
    Logger.log('  2. File ID salah');
    Logger.log('  3. File dihapus dari Drive');
  }
}

function debugStep3_GeminiPing() {
  Logger.log('Mengecek API Key...');

  if (!CONFIG.geminiApiKey || CONFIG.geminiApiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    Logger.log('❌ API Key belum diisi! Buka Code_Hybrid.gs dan isi CONFIG.geminiApiKey');
    return;
  }

  Logger.log('API Key  : ' + CONFIG.geminiApiKey.substring(0, 8) + '...(tersembunyi)');
  Logger.log('Mengirim ping ke Gemini...');

  try {
    const res = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + CONFIG.geminiApiKey,
      {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify({
          contents: [{ parts: [{ text: 'Jawab hanya dengan kata: OK' }] }]
        })
      }
    );

    const code = res.getResponseCode();
    const text = res.getContentText();
    Logger.log('HTTP Status: ' + code);

    if (code === 200) {
      const reply = JSON.parse(text)?.candidates?.[0]?.content?.parts?.[0]?.text;
      Logger.log('✅ Gemini API aktif! Reply: ' + reply);
    } else if (code === 400) {
      Logger.log('❌ HTTP 400 — API Key tidak valid atau format salah');
      Logger.log('Detail: ' + text.substring(0, 300));
    } else if (code === 403) {
      Logger.log('❌ HTTP 403 — API Key tidak punya akses ke model ini');
      Logger.log('Detail: ' + text.substring(0, 300));
    } else if (code === 429) {
      Logger.log('⚠️ HTTP 429 — Quota habis, coba lagi nanti');
    } else {
      Logger.log('❌ HTTP ' + code + ': ' + text.substring(0, 300));
    }
    Logger.log('=== Step 3 selesai ===');
  } catch(e) {
    Logger.log('❌ Tidak bisa koneksi ke Gemini: ' + e.toString());
  }
}

function debugStep4_FullGenerate() {
  Logger.log('=== START FULL GENERATE ===');

  // Ambil dokumen pertama yang ada
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName('Dokumen');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues();
  const doc = data.find(row => row[0] && row[6]);

  if (!doc) { Logger.log('❌ Tidak ada dokumen di Sheets.'); return; }

  Logger.log('Dokumen  : ' + doc[1]);
  Logger.log('URL      : ' + doc[6]);

  // Extract file ID
  const fileUrl = doc[6].toString();
  const match = fileUrl.match(/\/d\/([^\/\?]+)/);
  if (!match) { Logger.log('❌ Format URL tidak valid: ' + fileUrl); return; }

  const fileId = match[1];
  Logger.log('File ID  : ' + fileId);

  // Akses file
  let file;
  try {
    file = DriveApp.getFileById(fileId);
    Logger.log('File     : ' + file.getName() + ' (' + Math.round(file.getSize()/1024) + ' KB)');
  } catch(e) {
    Logger.log('❌ Tidak bisa akses Drive: ' + e.toString());
    return;
  }

  // Auto-fix sharing
  try {
    if (file.getSharingAccess().toString() === 'PRIVATE') {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      Logger.log('⚠️ Sharing diubah otomatis ke ANYONE_WITH_LINK');
    } else {
      Logger.log('Sharing  : ' + file.getSharingAccess() + ' (OK)');
    }
  } catch(e) {
    Logger.log('⚠️ Tidak bisa ubah sharing: ' + e.toString());
  }

  // Ambil bytes
  let bytes;
  try {
    bytes = file.getBlob().getBytes();
    Logger.log('Blob     : ' + bytes.length + ' bytes');
  } catch(e) {
    Logger.log('❌ Tidak bisa baca blob: ' + e.toString());
    return;
  }

  if (bytes.length > 10 * 1024 * 1024) {
    Logger.log('❌ File terlalu besar: ' + Math.round(bytes.length/1024/1024) + ' MB (max 10MB)');
    return;
  }

  // Encode & kirim ke Gemini
  Logger.log('Encoding base64...');
  const b64 = Utilities.base64Encode(bytes);
  Logger.log('Memanggil Gemini API...');

  let res;
  try {
    res = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + CONFIG.geminiApiKey,
      {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify({
          contents: [{ parts: [
            { text: 'Buatkan ringkasan 3-5 kalimat dari dokumen ini dalam Bahasa Indonesia. Fokus poin utama.' },
            { inlineData: { mimeType: 'application/pdf', data: b64 } }
          ]}]
        })
      }
    );
  } catch(e) {
    Logger.log('❌ Fetch error: ' + e.toString());
    return;
  }

  const code = res.getResponseCode();
  const responseText = res.getContentText();
  Logger.log('HTTP     : ' + code);

  if (code !== 200) {
    Logger.log('❌ Gemini error: ' + responseText.substring(0, 500));
    return;
  }

  const summary = JSON.parse(responseText)?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!summary) {
    Logger.log('❌ Ringkasan kosong dari API');
    Logger.log('Response: ' + responseText.substring(0, 300));
    return;
  }

  // Simpan ke Sheets
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === doc[0]) {
      sheet.getRange(i + 2, 8).setValue(summary);
      break;
    }
  }

  Logger.log('✅ SUKSES! Ringkasan disimpan:');
  Logger.log(summary);
  Logger.log('=== Step 4 selesai ===');
}



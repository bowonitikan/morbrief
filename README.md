# 🗄️ Brankas E-dokumen (Morbrief)

[cite_start]Sistem manajemen kearsipan (Document Management System) yang dibangun menggunakan Google Apps Script (GAS)[cite: 6]. [cite_start]Sistem ini dirancang untuk memudahkan penyimpanan, pencarian, dan pengelolaan dokumen PDF dengan fitur ringkasan (metadata) dan pembatasan akses pengguna[cite: 7].

## 🏛️ Arsitektur
- [cite_start]**Frontend & Backend:** Google Apps Script (Web App) [cite: 11]
- [cite_start]**Database:** Google Sheets [cite: 10]
- [cite_start]**Storage:** Google Drive [cite: 9]

## 🛠️ Persiapan Database (Google Sheets)
[cite_start]Buat satu file Google Sheets dengan dua Tab/Sheet utama[cite: 21]:
1. [cite_start]**Users:** Kolom `Username`, `Password`, `Role`, `Status`[cite: 21].
2. [cite_start]**Katalog_Arsip:** Kolom `ID_Arsip`, `Judul_Dokumen`, `Tanggal_Unggah`, `Uploader`, `Ringkasan`, `File_URL`, `File_ID`[cite: 21, 22].

## 🚀 Cara Instalasi (Local Development)
[cite_start]Sistem ini menggunakan `clasp` (Command Line Apps Script Projects) untuk sinkronisasi kode lokal dengan Google Server.

1. Clone repositori ini: `git clone https://github.com/bowonitikan/morbrief.git`
2. Login ke clasp: `clasp login`
3. Buat project GAS baru atau hubungkan ke script yang ada: `clasp create` / `clasp clone <script-id>`
4. [cite_start]Push kode ke GAS: `clasp push` [cite: 49]

/**
 * Script ini digunakan SEKALI untuk mengubah folder sesi WhatsApp
 * menjadi teks base64 yang bisa disimpan sebagai GitHub Secret.
 * 
 * Cara pakai: node encode-session.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const sessionPath = path.join(__dirname, '.wwebjs_auth', 'session');

if (!fs.existsSync(sessionPath)) {
    console.error('❌ Folder sesi tidak ditemukan!');
    console.error('   Pastikan kamu sudah menjalankan "node index.js" dan scan QR terlebih dahulu.');
    process.exit(1);
}

// Buat zip dari folder sesi
const zipPath = path.join(__dirname, 'wa_session.zip');

try {
    // Gunakan PowerShell untuk zip (sudah built-in di Windows)
    execSync(`powershell -Command "Compress-Archive -Path '${sessionPath}\\*' -DestinationPath '${zipPath}' -Force"`, { stdio: 'pipe' });
    
    // Encode zip ke base64
    const zipBuffer = fs.readFileSync(zipPath);
    const base64String = zipBuffer.toString('base64');
    
    // Simpan ke file teks
    const outputPath = path.join(__dirname, 'session_base64.txt');
    fs.writeFileSync(outputPath, base64String);
    
    // Hapus file zip sementara
    fs.unlinkSync(zipPath);
    
    console.log('✅ Berhasil! Sesi WhatsApp sudah di-encode.');
    console.log('');
    console.log('📋 Langkah selanjutnya:');
    console.log('1. Buka file "session_base64.txt" yang baru dibuat');
    console.log('2. Salin SEMUA isinya (teks panjang)');
    console.log('3. Buka GitHub repo -> Settings -> Secrets -> Actions');
    console.log('4. Klik "New repository secret"');
    console.log('5. Name: WA_SESSION_BASE64');
    console.log('6. Secret: paste semua teks dari session_base64.txt');
    console.log('7. Klik "Add secret"');
    console.log('');
    console.log('Setelah itu, GitHub Actions bisa menjalankan bot tanpa scan QR!');
} catch (err) {
    console.error('❌ Gagal membuat zip:', err.message);
}

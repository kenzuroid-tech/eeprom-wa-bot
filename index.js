require('dotenv').config();
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal');
const { createClient } = require('@supabase/supabase-js');

// Init Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Supabase URL atau Key belum disetting di .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Sambungkan ke MongoDB lalu jalankan bot
mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log('📦 Terhubung ke MongoDB Atlas!');
        const store = new MongoStore({ mongoose: mongoose });

        // Init WhatsApp Client dengan RemoteAuth (sesi tersimpan di MongoDB)
        const client = new Client({
            authStrategy: new RemoteAuth({
                store: store,
                backupSyncIntervalMs: 60000 // Backup setiap 1 menit (minimum)
            }),
            puppeteer: {
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });

        let sessionSaved = false;
        client.on('remote_session_saved', async () => {
            console.log('✅ Sesi WhatsApp berhasil disimpan ke MongoDB!');
            sessionSaved = true;
            // Jika bot sudah selesai kirim pesan, langsung matikan
            if (doneReminding) {
                console.log('👋 Sesi tersimpan. Bot mematikan diri sendiri.');
                await client.destroy();
                await mongoose.disconnect();
                process.exit(0);
            }
        });

        client.on('qr', (qr) => {
            console.log('📱 Silakan scan QR code di bawah ini menggunakan WhatsApp:');
            qrcode.generate(qr, { small: true });
        });

        let doneReminding = false;
        client.on('ready', async () => {
            console.log('✅ Bot WhatsApp berhasil terhubung!');
            console.log('🔄 Menjalankan pengecekan task...');

            await checkAndSendReminders(client);
            doneReminding = true;

            if (sessionSaved) {
                // Sesi sudah tersimpan, langsung matikan
                console.log('👋 Sesi sudah tersimpan. Bot mematikan diri sendiri.');
                await client.destroy();
                await mongoose.disconnect();
                process.exit(0);
            } else {
                console.log('⏳ Menunggu sesi tersimpan ke MongoDB...');
                // Timeout maksimal 2 menit jika sesi tidak tersimpan
                setTimeout(async () => {
                    console.log('⚠️ Timeout! Mematikan bot paksa.');
                    await client.destroy();
                    await mongoose.disconnect();
                    process.exit(0);
                }, 120000);
            }
        });

        client.initialize();
    })
    .catch(err => {
        console.error('❌ Gagal terhubung ke MongoDB:', err.message);
        process.exit(1);
    });

/**
 * Fungsi untuk mengecek task dan mengirim pengingat
 */
async function checkAndSendReminders(client) {
    try {
        // 1. Ambil task yang belum selesai dan memiliki deadline
        const { data: tasks, error: tasksError } = await supabase
            .from('v_tasks')
            .select('*')
            .not('status', 'in', '("done","cancelled")')
            .not('deadline', 'is', null)
            .not('assigned_to', 'is', null);

        if (tasksError) throw tasksError;

        if (!tasks || tasks.length === 0) {
            console.log('✨ Tidak ada task yang perlu diingatkan saat ini.');
            return;
        }

        // 2. Ambil profil untuk mendapatkan nomor WhatsApp
        const assigneeIds = [...new Set(tasks.map(t => t.assigned_to))];

        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, full_name, phone')
            .in('id', assigneeIds);

        if (profilesError) throw profilesError;

        // Bikin map profil supaya mudah dicari
        const profileMap = {};
        profiles.forEach(p => {
            if (p.phone) {
                let phone = p.phone.replace(/\D/g, '');
                if (phone.startsWith('0')) phone = '62' + phone.substring(1);
                profileMap[p.id] = { ...p, wa_number: `${phone}@c.us` };
            }
        });

        // 3. Kelompokkan task berdasarkan orangnya
        const tasksByUser = {};
        const today = new Date();

        tasks.forEach(task => {
            const userProfile = profileMap[task.assigned_to];
            if (!userProfile) return;

            const deadline = new Date(task.deadline);
            const diffTime = deadline - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays <= 3) {
                if (!tasksByUser[task.assigned_to]) {
                    tasksByUser[task.assigned_to] = {
                        profile: userProfile,
                        tasks: []
                    };
                }

                tasksByUser[task.assigned_to].tasks.push({
                    ...task,
                    diffDays
                });
            }
        });

        // 4. Kirim pesan
        for (const userId in tasksByUser) {
            const { profile, tasks } = tasksByUser[userId];

            let message = `*[BOT HUMAS EEPROM]*\n\n`;
            message += `Halo *${profile.full_name}*!\n`;
            message += `Mengingatkan ada *${tasks.length} tugas* yang harus kamu selesaikan nih:\n\n`;

            tasks.forEach((t, index) => {
                const programName = t.program_name || 'Lainnya (Tanpa Program)';
                const dateStr = new Date(t.deadline).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

                let timeStatus = t.diffDays < 0 ? `❗ *Terlambat ${Math.abs(t.diffDays)} hari*` :
                    t.diffDays === 0 ? `⚠️ *Hari ini*` :
                        `⏳ H-${t.diffDays}`;

                message += `${index + 1}. *${t.title}*\n`;
                message += `   🏢 ${programName}\n`;
                message += `   ⏰ ${dateStr} (${timeStatus})\n\n`;
            });

            message += `Yuk segera dikerjakan dan update statusnya di website ya! Semangat! 🔥\n\n`;
            message += `_Pesan ini dikirim otomatis oleh sistem_`;

            try {
                await client.sendMessage(profile.wa_number, message);
                console.log(`✅ Berhasil mengirim pengingat ke ${profile.full_name} (${profile.wa_number})`);
            } catch (err) {
                console.error(`❌ Gagal mengirim ke ${profile.wa_number}:`, err.message);
            }
        }

    } catch (err) {
        console.error('Error saat mengecek task:', err.message);
    }
}

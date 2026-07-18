require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
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

// Init WhatsApp Client dengan LocalAuth
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('📱 Silakan scan QR code di bawah ini menggunakan WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('✅ Bot WhatsApp berhasil terhubung!');
    console.log('🔄 Menjalankan pengecekan task...');

    await checkAndSendReminders();

    console.log('👋 Selesai! Bot mematikan diri sendiri.');
    await client.destroy();
    process.exit(0);
});

client.initialize();

/**
 * Fungsi untuk mengecek task dan mengirim pengingat
 */
async function checkAndSendReminders() {
    try {
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

        const assigneeIds = [...new Set(tasks.map(t => t.assigned_to))];

        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, full_name, phone')
            .in('id', assigneeIds);

        if (profilesError) throw profilesError;

        const profileMap = {};
        profiles.forEach(p => {
            if (p.phone) {
                let phone = p.phone.replace(/\D/g, '');
                if (phone.startsWith('0')) phone = '62' + phone.substring(1);
                profileMap[p.id] = { ...p, wa_number: `${phone}@c.us` };
            }
        });

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
                    tasksByUser[task.assigned_to] = { profile: userProfile, tasks: [] };
                }
                tasksByUser[task.assigned_to].tasks.push({ ...task, diffDays });
            }
        });

        for (const userId in tasksByUser) {
            const { profile, tasks } = tasksByUser[userId];

            let message = `*[BOT HUMAS EEPROM]*\n\n`;
            message += `Halo *${profile.full_name}*!\n`;
            message += `Mengingatkan ada *${tasks.length} tugas* yang harus kamu selesaikan nih:\n\n`;

            tasks.forEach((t, index) => {
                const programName = t.program_name || 'Lainnya (Tanpa Program)';
                const dateStr = new Date(t.deadline).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                let timeStatus = t.diffDays < 0 ? `❗ *Terlambat ${Math.abs(t.diffDays)} hari*` :
                    t.diffDays === 0 ? `⚠️ *Hari ini*` : `⏳ H-${t.diffDays}`;

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

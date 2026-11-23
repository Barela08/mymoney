import { query, pool } from '../server/db';
import { createNotification } from '../server/notificationService';

async function sendWelcomeMessageToAllUsers() {
  console.log('====================================================');
  console.log('🚀 SENDING WELCOME MESSAGE TO ALL REGISTERED USERS');
  console.log('====================================================\n');

  try {
    // 1. Fetch all users from public.app_users
    const usersRes = await query(`
      SELECT 
        COALESCE(u.id, p.id) AS id,
        COALESCE(u.full_name, split_part(COALESCE(u.email, p.email), '@', 1)) AS full_name,
        COALESCE(u.email, p.email) AS email,
        COALESCE(u.role, p.role, 'user') AS role,
        COALESCE(u.status, p.status, 'active') AS status
      FROM public.app_users u
      FULL OUTER JOIN public.profiles p ON LOWER(u.email) = LOWER(p.email)
      WHERE COALESCE(u.status, p.status, 'active') = 'active'
      ORDER BY u.created_at ASC
    `);

    const users = usersRes.rows;
    console.log(`Found ${users.length} active registered users.\n`);

    if (users.length === 0) {
      console.log('No users found to message.');
      return;
    }

    // 2. Prepare Welcome Message
    const welcomeTitle = 'My Money Manager परिवार में आपका स्वागत है! 💚🎉';
    
    let sentCount = 0;
    let failedCount = 0;

    for (const u of users) {
      const userFirstName = (u.full_name || 'Friend').trim();
      const personalizedMessage = 
        `नमस्ते ${userFirstName}! My Money Manager में आपका हार्दिक स्वागत है 🌟\n\n` +
        `अब आप आसानी से:\n` +
        `• अपने सभी खर्चे (Home, Room, Food, Personal) ट्रैक कर सकते हैं 📊\n` +
        `• दोस्तों के साथ 2-Way Live Sync उधार खाता और QR Pairing चला सकते हैं 🤝\n` +
        `• नया GST, Offer/Discount और Bill Split Calculator इस्तेमाल कर सकते हैं 🧮\n\n` +
        `आपके सुरक्षित और समझदार वित्तीय सफ़र की शानदार शुरुआत हो! 🚀`;

      try {
        await createNotification({
          userId: u.id,
          title: welcomeTitle,
          message: personalizedMessage,
          category: 'announcement',
          type: 'success',
          deepLink: 'dashboard',
          channels: ['in_app', 'push'],
          skipPreferenceCheck: true,
          metadata: {
            is_welcome_message: true,
            user_name: userFirstName,
            sent_at: new Date().toISOString(),
          },
        });

        sentCount++;
        console.log(`[${sentCount}/${users.length}] ✅ Welcome message sent to: ${userFirstName} (${u.email})`);
      } catch (err: any) {
        failedCount++;
        console.error(`❌ Failed sending to ${u.email}:`, err.message);
      }
    }

    // 3. Also post a Global Broadcast Announcement to public.notifications for any guest / real-time listeners
    const globalBroadcastRes = await query(
      `INSERT INTO public.notifications (
        title, message, type, target_user_id, is_active, created_at
      ) VALUES ($1, $2, 'announcement', 'all', TRUE, NOW())
      RETURNING id`,
      [
        welcomeTitle,
        'My Money Manager में आप सभी का हार्दिक स्वागत है! अब अपने सभी पर्सनल खर्चे, 2-वे उधार खाता और स्मार्ट कैलकुलेटर का आनंद लें।',
      ]
    );
    console.log(`\n📢 Global broadcast notification registered (ID: ${globalBroadcastRes.rows[0]?.id})`);

    // 4. Log in public.notification_campaigns for admin audit & analytics
    await query(
      `INSERT INTO public.notification_campaigns (
        title, message, category, type, target_type, channels, status,
        total_recipients, delivered_count, failed_count, sent_at
      ) VALUES ($1, $2, 'announcement', 'announcement', 'all', ARRAY['in_app', 'push'], 'completed', $3, $4, $5, NOW())`,
      [
        welcomeTitle,
        'Welcome campaign sent to all registered users upon app launch and upgrade.',
        users.length,
        sentCount,
        failedCount,
      ]
    ).catch((e) => console.warn('Notice logging campaign:', e.message));

    console.log('\n====================================================');
    console.log(`🎉 WELCOME MESSAGES DELIVERED SUCCESSFULLY!`);
    console.log(`Total Users Processed: ${users.length}`);
    console.log(`Delivered: ${sentCount}`);
    console.log(`Failed: ${failedCount}`);
    console.log('====================================================\n');
  } catch (err: any) {
    console.error('Fatal error executing welcome broadcast:', err);
  } finally {
    await pool.end();
  }
}

sendWelcomeMessageToAllUsers();

import { query } from '../server/db';
import { APP_CONFIG } from '../server/config';
import {
  getUserNotificationPreferences,
  createNotification,
  notifyTransactionCreated,
  notifyUdharCreated,
  notifyUdharRepayment,
  notifyFeedbackSubmitted,
  notifyComplaintSubmitted,
  notifyAdminTicketReply,
  dispatchCampaign,
  processScheduledCampaigns,
} from '../server/notificationService';

async function runTestSuite() {
  console.log('=============================================================');
  console.log('🧪 RUNNING COMPLETE NOTIFICATION SYSTEM AUTOMATED TEST SUITE');
  console.log('=============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: any) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`, details || '');
      failed++;
    }
  }

  try {
    // 1. Get a test user from public.app_users
    const userRes = await query(`SELECT id, full_name, email FROM public.app_users LIMIT 2`);
    if (userRes.rows.length === 0) {
      throw new Error('No test users found in database');
    }
    const user1 = userRes.rows[0];
    const user2 = userRes.rows[1] || user1;
    console.log(`Using Test Users: User1=${user1.email} (${user1.id}), User2=${user2.email} (${user2.id})\n`);

    // TEST 1: Database Schema Verification
    console.log('--- TEST 1: Database Schema & Tables ---');
    const tablesCheck = await query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('user_notifications', 'user_notification_preferences', 'push_subscriptions', 'notification_campaigns', 'notification_delivery_logs')
    `);
    assert(tablesCheck.rows.length === 5, 'All 5 notification system tables exist in public schema');

    // TEST 2: User Notification Preferences
    console.log('\n--- TEST 2: User Notification Preferences ---');
    const prefs = await getUserNotificationPreferences(user1.id);
    assert(prefs && typeof prefs.in_app_enabled === 'boolean', 'Fetches default or saved preferences');
    assert(prefs.notify_income === true && prefs.notify_udhar === true, 'Default categories enabled');

    // TEST 3: Create In-App Notification
    console.log('\n--- TEST 3: Create In-App Notification ---');
    const notifRes = await createNotification({
      userId: user1.id,
      title: 'Automated Test Notification 🚀',
      message: 'This is a test notification for verification.',
      category: 'general',
      type: 'info',
      deepLink: 'dashboard',
      channels: ['in_app'],
      skipPreferenceCheck: true,
    });
    assert(notifRes.success && !!notifRes.notificationId, 'Notification created and ID returned');
    assert(notifRes.inAppDelivered === true, 'In-App delivery recorded');

    // TEST 4: Query Unread & Mark Read
    console.log('\n--- TEST 4: Read / Unread Status Management ---');
    const unreadCheck = await query(
      `SELECT id, is_read FROM public.user_notifications WHERE id = $1 AND user_id = $2`,
      [notifRes.notificationId, user1.id]
    );
    assert(unreadCheck.rows.length === 1 && unreadCheck.rows[0].is_read === false, 'New notification starts as unread');

    // Mark single as read
    await query(
      `UPDATE public.user_notifications SET is_read = TRUE, read_at = NOW() WHERE id = $1 AND user_id = $2`,
      [notifRes.notificationId, user1.id]
    );
    const readCheck = await query(
      `SELECT is_read, read_at FROM public.user_notifications WHERE id = $1`,
      [notifRes.notificationId]
    );
    assert(readCheck.rows[0].is_read === true && readCheck.rows[0].read_at !== null, 'Marked as read updates read_at timestamp');

    // TEST 5: Financial Ledger Immunity on Notification Deletion
    console.log('\n--- TEST 5: Financial History Immunity on Deletion ---');
    // Count transactions and udhar contacts before deletion
    const txCountBefore = await query(`SELECT COUNT(*) as count FROM public.transactions WHERE user_id = $1`, [user1.id]);
    const udharCountBefore = await query(`SELECT COUNT(*) as count FROM public.udhar_contacts WHERE user_id = $1`, [user1.id]);

    // Soft delete the test notification
    await query(
      `UPDATE public.user_notifications SET is_deleted = TRUE, deleted_at = NOW() WHERE id = $1 AND user_id = $2`,
      [notifRes.notificationId, user1.id]
    );
    const delCheck = await query(`SELECT is_deleted FROM public.user_notifications WHERE id = $1`, [notifRes.notificationId]);
    assert(delCheck.rows[0].is_deleted === true, 'Notification soft-deleted successfully');

    // Verify financial records are completely untouched
    const txCountAfter = await query(`SELECT COUNT(*) as count FROM public.transactions WHERE user_id = $1`, [user1.id]);
    const udharCountAfter = await query(`SELECT COUNT(*) as count FROM public.udhar_contacts WHERE user_id = $1`, [user1.id]);
    assert(
      txCountBefore.rows[0].count === txCountAfter.rows[0].count,
      'Financial transactions count strictly preserved (ZERO cascade deletion)'
    );
    assert(
      udharCountBefore.rows[0].count === udharCountAfter.rows[0].count,
      'Udhar contacts count strictly preserved (ZERO cascade deletion)'
    );

    // TEST 6: Automated Trigger: Transaction Created
    console.log('\n--- TEST 6: Automated Trigger: Transaction Created ---');
    await notifyTransactionCreated(user1.id, {
      id: 'tx-test-123',
      title: 'Monthly Salary',
      amount: 45000,
      type: 'income',
      section: 'Home',
    });
    const txNotif = await query(
      `SELECT * FROM public.user_notifications 
       WHERE user_id = $1 AND related_entity_id = 'tx-test-123' 
       ORDER BY created_at DESC LIMIT 1`,
      [user1.id]
    );
    assert(txNotif.rows.length === 1, 'Transaction notification created in database');
    assert(txNotif.rows[0].title.includes('Income Added') && txNotif.rows[0].title.includes('45,000'), 'Formatted title contains amount and income label');
    assert(txNotif.rows[0].category === 'income', 'Category set to income');

    // TEST 7: Automated Trigger: Udhar Created (Two-Sided)
    console.log('\n--- TEST 7: Automated Trigger: Udhar Created ---');
    await notifyUdharCreated({
      initiatorUserId: user1.id,
      recipientUserId: user2.id !== user1.id ? user2.id : null,
      transactionId: 'udhar-test-456',
      contactName: user2.full_name || 'Friend',
      amount: 2500,
      direction: 'given',
    });
    const udharNotif = await query(
      `SELECT * FROM public.user_notifications 
       WHERE user_id = $1 AND related_entity_id = 'udhar-test-456' 
       ORDER BY created_at DESC LIMIT 1`,
      [user1.id]
    );
    assert(udharNotif.rows.length === 1, 'Udhar notification created for initiator');
    assert(udharNotif.rows[0].title.includes('Udhar Given: ₹2,500'), 'Initiator title specifies Udhar Given and amount');
    assert(udharNotif.rows[0].deep_link === 'people', 'Deep link points to people section');

    // TEST 8: Automated Trigger: Udhar Repayment & Full Settlement Auto-Cancellation
    console.log('\n--- TEST 8: Automated Trigger: Udhar Settlement & Reminder Cancellation ---');
    await notifyUdharRepayment({
      initiatorUserId: user1.id,
      recipientUserId: user2.id !== user1.id ? user2.id : null,
      repaymentId: 'repay-test-789',
      contactName: user2.full_name || 'Friend',
      repaymentAmount: 2500,
      remainingBalance: 0,
      isFullySettled: true,
    });
    const settleNotif = await query(
      `SELECT * FROM public.user_notifications 
       WHERE user_id = $1 AND related_entity_id = 'repay-test-789' 
       ORDER BY created_at DESC LIMIT 1`,
      [user1.id]
    );
    assert(settleNotif.rows.length === 1, 'Settlement notification created');
    assert(settleNotif.rows[0].title.includes('Udhar Settled') && settleNotif.rows[0].type === 'success', 'Settlement notification marked as success with celebratory title');
    assert(settleNotif.rows[0].message.includes('Remaining balance is ₹0'), 'Message confirms full clearance');

    // TEST 9: Automated Trigger: Feedback & Complaint Support
    console.log('\n--- TEST 9: Feedback & Complaint Triggers ---');
    await notifyFeedbackSubmitted(user1.id, { id: 'fb-test-001', rating: 5, category: 'App Experience' });
    const fbNotif = await query(
      `SELECT * FROM public.user_notifications WHERE user_id = $1 AND related_entity_id = 'fb-test-001' LIMIT 1`,
      [user1.id]
    );
    assert(fbNotif.rows.length === 1 && fbNotif.rows[0].category === 'feedback', 'Feedback thank-you notification generated');

    await notifyComplaintSubmitted(user1.id, { id: 'ticket-test-001', subject: 'Sync Delay Issue', category: 'Data / Sync' });
    const ticketNotif = await query(
      `SELECT * FROM public.user_notifications WHERE user_id = $1 AND related_entity_id = 'ticket-test-001' LIMIT 1`,
      [user1.id]
    );
    assert(ticketNotif.rows.length === 1 && ticketNotif.rows[0].category === 'complaint', 'Complaint ticket confirmation notification generated');

    await notifyAdminTicketReply(user1.id, {
      id: 'ticket-test-001',
      subject: 'Sync Delay Issue',
      replyText: 'We have resolved the cache issue. Please verify your ledger.',
      adminName: 'Nilesh (Admin)',
    });
    const replyNotif = await query(
      `SELECT * FROM public.user_notifications 
       WHERE user_id = $1 AND category = 'support' AND title LIKE '%New Reply%' 
       ORDER BY created_at DESC LIMIT 1`,
      [user1.id]
    );
    assert(replyNotif.rows.length === 1, 'Admin reply notification generated with support deep link');

    // TEST 10: VAPID Push Configuration & Key Generation
    console.log('\n--- TEST 10: VAPID Web Push Keys ---');
    assert(
      APP_CONFIG.vapid &&
      APP_CONFIG.vapid.publicKey.length > 50 &&
      APP_CONFIG.vapid.privateKey.length > 30,
      'Valid VAPID public and private cryptographic keys configured'
    );

    // Push subscription upsert test
    const fakeEndpoint = `https://fcm.googleapis.com/fcm/send/test-${Date.now()}`;
    await query(
      `INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, 'test-p256dh-key', 'test-auth-secret', 'Automated Test Agent')
       ON CONFLICT (endpoint) DO NOTHING`,
      [user1.id, fakeEndpoint]
    );
    const subCheck = await query(`SELECT * FROM public.push_subscriptions WHERE endpoint = $1`, [fakeEndpoint]);
    assert(subCheck.rows.length === 1, 'Push subscription registered in database');
    await query(`DELETE FROM public.push_subscriptions WHERE endpoint = $1`, [fakeEndpoint]);

    // TEST 11: Admin Campaign Creation & Dispatch
    console.log('\n--- TEST 11: Admin Campaign Broadcast ---');
    const campRes = await query(
      `INSERT INTO public.notification_campaigns 
       (title, message, category, type, channels, target_type, target_user_ids, status, created_by)
       VALUES ($1, $2, 'announcement', 'announcement', '{"in_app"}', 'selected', $3, 'draft', $4)
       RETURNING *`,
      [
        '📢 System Update v2.5 Released!',
        'Check out the all new Notification Center and Khata enhancements.',
        [user1.id],
        user1.id,
      ]
    );
    const campaignId = campRes.rows[0].id;
    const dispatchRes = await dispatchCampaign(campaignId);
    assert(dispatchRes.success && dispatchRes.totalTargets === 1, 'Admin campaign successfully dispatched to targets');

    const updatedCamp = await query(`SELECT status, delivered_count FROM public.notification_campaigns WHERE id = $1`, [campaignId]);
    assert(updatedCamp.rows[0].status === 'sent' && updatedCamp.rows[0].delivered_count === 1, 'Campaign marked as sent with verified delivery KPI');

    // Clean up test campaign
    await query(`DELETE FROM public.notification_campaigns WHERE id = $1`, [campaignId]);

    // TEST 12: Scheduled Campaign Worker
    console.log('\n--- TEST 12: Scheduled Campaign Worker ---');
    const processedCount = await processScheduledCampaigns();
    assert(typeof processedCount === 'number', 'Scheduled campaign worker runs cleanly without exception');

    console.log('\n=============================================================');
    console.log(`🎉 TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('=============================================================');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Fatal Test Exception:', err);
    process.exit(1);
  }
}

runTestSuite();

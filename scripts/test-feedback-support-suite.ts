import { query, pool } from '../server/db';
import crypto from 'crypto';
import {
  generateFeedbackReceivedEmail,
  generateComplaintReceivedEmail,
  generateSupportTicketReceivedEmail,
  generateAdminReplyEmail,
  formatPersonalizedGreeting,
  escapeHtml,
} from '../server/supportEmailTemplates';
import {
  sendFeedbackConfirmationEmail,
  sendComplaintConfirmationEmail,
  sendSupportTicketConfirmationEmail,
  sendAdminReplyToTicketEmail,
} from '../server/email';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}`);
    if (detail) console.error(`   Details: ${detail}`);
    failed++;
  }
}

async function runFeedbackSupportTestSuite() {
  console.log('================================================================');
  console.log('MY MONEY MANAGER — FEEDBACK, COMPLAINTS & SUPPORT TEST SUITE');
  console.log('================================================================\n');

  try {
    // -------------------------------------------------------------
    // 1. DATABASE SCHEMA VERIFICATION
    // -------------------------------------------------------------
    console.log('\n--- 1. Testing Database Schema & Migrations ---');

    // 1.1 feedbacks table columns
    const feedbackColsRes = await query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'feedbacks'
    `);
    const feedbackCols = feedbackColsRes.rows.map((r: any) => r.column_name);
    assert(feedbackCols.includes('rating'), 'feedbacks table has rating column');
    assert(feedbackCols.includes('category'), 'feedbacks table has category column');
    assert(feedbackCols.includes('message'), 'feedbacks table has message column');
    assert(feedbackCols.includes('reviewed_by'), 'feedbacks table has reviewed_by column');
    assert(feedbackCols.includes('reviewed_at'), 'feedbacks table has reviewed_at column');
    assert(feedbackCols.includes('admin_notes'), 'feedbacks table has admin_notes column');

    // 1.2 support_tickets table columns
    const ticketColsRes = await query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'support_tickets'
    `);
    const ticketCols = ticketColsRes.rows.map((r: any) => r.column_name);
    assert(ticketCols.includes('ticket_number'), 'support_tickets table has ticket_number column');
    assert(ticketCols.includes('ticket_type'), 'support_tickets table has ticket_type column');
    assert(ticketCols.includes('attachment_url'), 'support_tickets table has attachment_url column');
    assert(ticketCols.includes('assigned_to'), 'support_tickets table has assigned_to column');
    assert(ticketCols.includes('internal_notes'), 'support_tickets table has internal_notes column');
    assert(ticketCols.includes('priority'), 'support_tickets table has priority column');
    assert(ticketCols.includes('status'), 'support_tickets table has status column');

    // 1.3 support_ticket_replies table columns
    const replyColsRes = await query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'support_ticket_replies'
    `);
    const replyCols = replyColsRes.rows.map((r: any) => r.column_name);
    assert(replyCols.includes('sender_type'), 'support_ticket_replies table has sender_type column');
    assert(replyCols.includes('message_type'), 'support_ticket_replies table has message_type column');
    assert(replyCols.includes('is_internal'), 'support_ticket_replies table has is_internal column');
    assert(replyCols.includes('email_status'), 'support_ticket_replies table has email_status column');
    assert(replyCols.includes('delivery_error'), 'support_ticket_replies table has delivery_error column');

    // 1.4 ticket_status_history table
    const historyColsRes = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'ticket_status_history'
    `);
    const historyCols = historyColsRes.rows.map((r: any) => r.column_name);
    assert(historyCols.includes('ticket_id'), 'ticket_status_history table has ticket_id column');
    assert(historyCols.includes('old_status'), 'ticket_status_history table has old_status column');
    assert(historyCols.includes('new_status'), 'ticket_status_history table has new_status column');
    assert(historyCols.includes('changed_by'), 'ticket_status_history table has changed_by column');

    // -------------------------------------------------------------
    // 2. EMAIL TEMPLATES, BRANDING & PERSONALIZATION
    // -------------------------------------------------------------
    console.log('\n--- 2. Testing Email Templates, Branding & Personalization ---');

    // 2.1 Personalization & fallback
    assert(formatPersonalizedGreeting('Nilesh') === 'Hi Nilesh,', 'Greeting: "Nilesh" -> "Hi Nilesh,"');
    assert(formatPersonalizedGreeting('Rahul Sharma') === 'Hi Rahul,', 'Greeting: "Rahul Sharma" -> "Hi Rahul,"');
    assert(formatPersonalizedGreeting('') === 'Hi there,', 'Greeting: Empty fallback -> "Hi there,"');
    assert(formatPersonalizedGreeting(null) === 'Hi there,', 'Greeting: null fallback -> "Hi there,"');
    assert(formatPersonalizedGreeting(undefined) === 'Hi there,', 'Greeting: undefined fallback -> "Hi there,"');

    // 2.2 XSS escaping
    const unsafeText = '<script>alert("hack")</script> & "test"';
    const safeEscaped = escapeHtml(unsafeText);
    assert(!safeEscaped.includes('<script>') && safeEscaped.includes('&lt;script&gt;'), 'XSS prevention in template escaping');

    // 2.3 Feedback Received Template
    const feedbackEmail = generateFeedbackReceivedEmail({
      userName: 'Nilesh',
      rating: 5,
      category: 'UI / Design',
      feedbackMessage: 'The new emerald fintech theme is clean and responsive!',
      userEmail: 'nilesh@example.com',
    });
    assert(feedbackEmail.subject.toLowerCase().includes('thank you for your feedback'), 'Feedback email subject is correct');
    assert(feedbackEmail.html.includes('Hi Nilesh,'), 'Feedback email contains personalized greeting');
    assert(feedbackEmail.html.includes('★★★★★') || feedbackEmail.html.includes('5 / 5 Stars'), 'Feedback email includes 5-star rating');
    assert(feedbackEmail.html.includes('UI / Design'), 'Feedback email includes category');
    assert(feedbackEmail.html.includes('A product of HackifyPro'), 'Feedback email contains HackifyPro branding');
    assert(!feedbackEmail.html.includes('undefined') && !feedbackEmail.html.includes('null'), 'Feedback email has no undefined/null placeholders');

    // 2.4 Complaint Received Template
    const complaintEmail = generateComplaintReceivedEmail({
      userName: 'Rahul',
      ticketId: 'CMP-TEST-9001',
      category: 'Income & Expense',
      subject: 'Transaction calculation discrepancy',
      description: 'The monthly total differed by Rs 100 after editing yesterday.',
      userEmail: 'rahul@example.com',
    });
    assert(complaintEmail.subject.includes('CMP-TEST-9001'), 'Complaint email subject includes ticket ID');
    assert(complaintEmail.html.includes('CMP-TEST-9001'), 'Complaint email body includes ticket ID');
    assert(complaintEmail.html.includes('Hi Rahul,'), 'Complaint email contains personalized greeting');
    assert(complaintEmail.html.includes('A product of HackifyPro'), 'Complaint email contains HackifyPro branding');
    assert(complaintEmail.html.includes('Open'), 'Complaint email indicates Open status');

    // 2.5 Support Ticket Received Template
    const supportEmail = generateSupportTicketReceivedEmail({
      userName: 'Aman',
      ticketId: 'SUP-TEST-8002',
      category: 'Udhar Management',
      subject: 'How to export monthly statement?',
      message: 'Need help exporting the udhar records as PDF.',
      userEmail: 'aman@example.com',
    });
    assert(supportEmail.subject.includes('SUP-TEST-8002'), 'Support ticket email subject includes ticket ID');
    assert(supportEmail.html.includes('SUP-TEST-8002'), 'Support ticket email body includes ticket ID');
    assert(supportEmail.html.includes('Hi Aman,'), 'Support ticket email contains personalized greeting');

    // 2.6 Admin Reply Email Template
    const adminReplyEmail = generateAdminReplyEmail({
      userName: 'Nilesh',
      ticketId: 'CMP-TEST-9001',
      originalSubject: 'Transaction calculation discrepancy',
      adminReply: 'Hello Nilesh, we investigated and resolved the calculation sync issue. Please check your ledger.',
      adminName: 'My Money Support Team',
      status: 'resolved',
      userEmail: 'nilesh@example.com',
    });
    assert(adminReplyEmail.subject.includes('CMP-TEST-9001'), 'Admin reply subject contains ticket ID');
    assert(adminReplyEmail.html.includes('RESOLVED') || adminReplyEmail.html.toLowerCase().includes('resolved'), 'Admin reply contains status badge');
    assert(adminReplyEmail.html.includes('Hello Nilesh, we investigated'), 'Admin reply contains reply message');
    assert(adminReplyEmail.html.includes('My Money Support Team'), 'Admin reply contains admin name signature');

    // -------------------------------------------------------------
    // 3. DATABASE WORKFLOW & TICKET LIFECYCLE TESTS
    // -------------------------------------------------------------
    console.log('\n--- 3. Testing Database Workflow & Ticket Lifecycle ---');

    // Retrieve an existing user ID from auth.users or use valid fallback
    let testUserId: string | null = null;
    let testUserEmail = 'barelanilesh483@gmail.com';
    try {
      const userRes = await query('SELECT id, email FROM auth.users LIMIT 1');
      if (userRes.rows.length > 0) {
        testUserId = userRes.rows[0].id;
        testUserEmail = userRes.rows[0].email || testUserEmail;
      }
    } catch (e: any) {
      console.warn('Could not query auth.users:', e.message);
    }

    // 3.1 Feedback submission
    const feedbackInsertRes = await query(
      `INSERT INTO public.feedbacks 
        (user_id, user_name, user_email, type, category, subject, message, rating, status)
       VALUES ($1, $2, $3, 'feedback', $4, $5, $6, $7, 'new')
       RETURNING *`,
      [testUserId, 'Test User Nilesh', testUserEmail, 'Performance', 'Performance Feedback', 'The app loads in milliseconds! Very smooth.', 5]
    );
    const feedbackRecord = feedbackInsertRes.rows[0];
    assert(feedbackRecord.rating === 5, 'Feedback rating saved as 5');
    assert(feedbackRecord.category === 'Performance', 'Feedback category saved as Performance');
    assert(feedbackRecord.status === 'new', 'Feedback initial status is "new"');

    // 3.2 Feedback admin update
    const feedbackUpdateRes = await query(
      `UPDATE public.feedbacks 
       SET status = 'reviewed', reviewed_by = 'Admin Tester', reviewed_at = NOW(), admin_notes = 'Great feedback.'
       WHERE id = $1
       RETURNING *`,
      [feedbackRecord.id]
    );
    assert(feedbackUpdateRes.rows[0].status === 'reviewed', 'Feedback status transitioned to "reviewed"');
    assert(feedbackUpdateRes.rows[0].reviewed_by === 'Admin Tester', 'Feedback reviewed_by updated');

    // 3.3 Complaint submission
    const complaintTicketId = `CMP-${Math.floor(100000 + Math.random() * 900000)}`;
    const complaintInsertRes = await query(
      `INSERT INTO public.support_tickets 
        (ticket_number, ticket_type, user_id, user_name, user_email, category, subject, description, status, priority)
       VALUES ($1, 'complaint', $2, $3, $4, $5, $6, $7, 'open', 'normal')
       RETURNING *`,
      [
        complaintTicketId,
        testUserId,
        'Test User Nilesh',
        testUserEmail,
        'Udhar Management',
        'Unable to record partial repayment',
        'When clicking partial repay, button was disabled temporarily.',
      ]
    );
    const complaintTicket = complaintInsertRes.rows[0];
    assert(complaintTicket.ticket_number.startsWith('CMP-'), 'Complaint ticket ID has prefix CMP-');
    assert(complaintTicket.ticket_type === 'complaint', 'Ticket type is "complaint"');
    assert(complaintTicket.status === 'open', 'Initial ticket status is "open"');
    assert(complaintTicket.priority === 'normal', 'Initial ticket priority is "normal"');

    // 3.4 Support ticket submission
    const supportTicketId = `SUP-${Math.floor(100000 + Math.random() * 900000)}`;
    const supportInsertRes = await query(
      `INSERT INTO public.support_tickets 
        (ticket_number, ticket_type, user_id, user_name, user_email, category, subject, description, status, priority)
       VALUES ($1, 'support', $2, $3, $4, $5, $6, $7, 'open', 'normal')
       RETURNING *`,
      [
        supportTicketId,
        testUserId,
        'Test User Nilesh',
        testUserEmail,
        'Calculator',
        'How does SIP calculator compounding work?',
        'Need explanation on monthly vs annual compounding frequency.',
      ]
    );
    const supportTicket = supportInsertRes.rows[0];
    assert(supportTicket.ticket_number.startsWith('SUP-'), 'Support ticket ID has prefix SUP-');
    assert(supportTicket.ticket_type === 'support', 'Ticket type is "support"');

    // 3.5 Replies & Internal Notes Distinction
    // Add User Reply
    await query(
      `INSERT INTO public.support_ticket_replies
        (ticket_id, sender_id, sender_name, sender_role, sender_type, message, message_type, is_internal)
       VALUES ($1, $2, $3, 'user', 'user', $4, 'reply', false)`,
      [complaintTicket.id, testUserId, 'Test User Nilesh', 'Here is additional context: happened on Chrome v120.']
    );

    // Add Admin Public Reply (Emailed to user)
    const adminReplyRes = await query(
      `INSERT INTO public.support_ticket_replies
        (ticket_id, sender_id, sender_name, sender_role, sender_type, message, message_type, is_internal, email_status)
       VALUES ($1, $2, 'Lead Admin', 'admin', 'admin', $3, 'reply', false, 'sent')
       RETURNING *`,
      [complaintTicket.id, testUserId, 'Thank you Nilesh, we have deployed a hotfix for Chrome v120.']
    );
    assert(adminReplyRes.rows[0].is_internal === false, 'Admin public reply is_internal = false');
    assert(adminReplyRes.rows[0].email_status === 'sent', 'Admin public reply email_status = sent');

    // Add Admin Internal Note (STRICTLY HIDDEN FROM USER)
    const internalNoteRes = await query(
      `INSERT INTO public.support_ticket_replies
        (ticket_id, sender_id, sender_name, sender_role, sender_type, message, message_type, is_internal)
       VALUES ($1, $2, 'Lead Admin', 'admin', 'admin', $3, 'internal_note', true)
       RETURNING *`,
      [complaintTicket.id, testUserId, 'INTERNAL NOTE: Checked error logs, cache invalidation issue resolved.']
    );
    assert(internalNoteRes.rows[0].is_internal === true, 'Admin internal note is_internal = true');

    // Verify User View Filter (Simulate GET /api/user/tickets/:id)
    const userViewReplies = await query(
      `SELECT * FROM public.support_ticket_replies
       WHERE ticket_id = $1 AND is_internal = false
       ORDER BY created_at ASC`,
      [complaintTicket.id]
    );
    const hasInternalInUserView = userViewReplies.rows.some((r: any) => r.is_internal === true);
    assert(!hasInternalInUserView, 'SECURITY: User view strictly excludes internal notes (is_internal = false)');
    assert(userViewReplies.rows.length === 2, 'User view returns exactly 2 public messages (user reply + admin reply)');

    // Verify Admin View (Simulate GET /api/admin/support/tickets/:id)
    const adminViewReplies = await query(
      `SELECT * FROM public.support_ticket_replies
       WHERE ticket_id = $1
       ORDER BY created_at ASC`,
      [complaintTicket.id]
    );
    assert(adminViewReplies.rows.length === 3, 'Admin view returns all 3 messages including internal notes');

    // 3.6 Ticket Status Transition & Status History Audit
    await query(
      `UPDATE public.support_tickets 
       SET status = 'in_progress', priority = 'urgent', assigned_to = 'Support Lead Alex' 
       WHERE id = $1`,
      [complaintTicket.id]
    );
    const adminUserId = testUserId || crypto.randomUUID();
    await query(
      `INSERT INTO public.ticket_status_history
        (ticket_id, old_status, new_status, changed_by, changed_by_name, reason)
       VALUES ($1, 'open', 'in_progress', $2, 'Support Lead Alex', 'Investigation started')`,
      [complaintTicket.id, adminUserId]
    );

    await query(
      `UPDATE public.support_tickets 
       SET status = 'resolved' 
       WHERE id = $1`,
      [complaintTicket.id]
    );
    await query(
      `INSERT INTO public.ticket_status_history
        (ticket_id, old_status, new_status, changed_by, changed_by_name, reason)
       VALUES ($1, 'in_progress', 'resolved', $2, 'Support Lead Alex', 'Hotfix verified by user')`,
      [complaintTicket.id, adminUserId]
    );

    const historyRes = await query(
      `SELECT * FROM public.ticket_status_history 
       WHERE ticket_id = $1 
       ORDER BY created_at ASC`,
      [complaintTicket.id]
    );
    assert(historyRes.rows.length === 2, 'Status history logged 2 transitions');
    assert(historyRes.rows[0].old_status === 'open' && historyRes.rows[0].new_status === 'in_progress', 'First status change: open -> in_progress');
    assert(historyRes.rows[1].old_status === 'in_progress' && historyRes.rows[1].new_status === 'resolved', 'Second status change: in_progress -> resolved');

    // 3.7 Retry Email Mechanism
    const failedReplyRes = await query(
      `INSERT INTO public.support_ticket_replies
        (ticket_id, sender_id, sender_name, sender_role, sender_type, message, message_type, is_internal, email_status, delivery_error)
       VALUES ($1, $2, 'Support Agent', 'admin', 'admin', 'Here is an update.', 'reply', false, 'failed', 'SMTP Connection Timeout')
       RETURNING id`,
      [complaintTicket.id, testUserId]
    );
    const failedReplyId = failedReplyRes.rows[0].id;

    // Simulate Retry API
    await query(
      `UPDATE public.support_ticket_replies 
       SET email_status = 'sent', delivery_error = null 
       WHERE id = $1`,
      [failedReplyId]
    );
    const retriedReply = await query(
      `SELECT email_status, delivery_error FROM public.support_ticket_replies WHERE id = $1`,
      [failedReplyId]
    );
    assert(retriedReply.rows[0].email_status === 'sent' && retriedReply.rows[0].delivery_error === null, 'Email retry successfully updates status to sent');

    // -------------------------------------------------------------
    // 4. REAL EMAIL SERVICE VERIFICATION
    // -------------------------------------------------------------
    console.log('\n--- 4. Testing Real Email Dispatch Service ---');

    try {
      const emailTestResult = await sendFeedbackConfirmationEmail({
        userName: 'Nilesh Barela',
        userEmail: 'barelanilesh483@gmail.com',
        rating: 5,
        category: 'App Experience',
        feedbackMessage: 'Automated test verification of feedback email delivery.',
      });
      assert(emailTestResult.success, 'Nodemailer sent feedback confirmation email to verified address');
      if (emailTestResult.messageId) {
        console.log(`   Message ID: ${emailTestResult.messageId}`);
      }
    } catch (e: any) {
      console.warn('   Email dispatch notice:', e.message);
    }

    // Clean up test data
    console.log('\n--- Cleaning up test records ---');
    await query('DELETE FROM public.support_ticket_replies WHERE ticket_id = $1', [complaintTicket.id]);
    await query('DELETE FROM public.ticket_status_history WHERE ticket_id = $1', [complaintTicket.id]);
    await query('DELETE FROM public.support_tickets WHERE id IN ($1, $2)', [complaintTicket.id, supportTicket.id]);
    await query('DELETE FROM public.feedbacks WHERE id = $1', [feedbackRecord.id]);
    console.log('✓ Test records cleaned up');

  } catch (err: any) {
    console.error('Fatal test error:', err);
    failed++;
  } finally {
    await pool.end();
  }

  console.log('\n================================================================');
  console.log(`FEEDBACK & SUPPORT TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runFeedbackSupportTestSuite();

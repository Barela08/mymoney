/**
 * Voice Transaction Parser for My Money Manager
 * Supports English and Hindi/Hinglish voice input commands:
 * - "Add expense 500 rupees for food"
 * - "Received 2000 rupees salary"
 * - "Spent 300 rupees on petrol"
 * - "Chai nashta 120 rupay"
 * - "Room rent 5000 rupees"
 * - "Rahul ko 500 udhar diye"
 */

import { TransactionCategory } from '../types';

export interface ParsedVoiceDraft {
  amount?: string;
  category?: TransactionCategory;
  subcategory?: string;
  title?: string;
  notes?: string;
  personName?: string;
  type?: 'expense' | 'income';
  rawTranscript: string;
  confidence: number; // 0 to 1
  isVoiceDraft: boolean;
}

export function parseVoiceTransaction(transcript: string): ParsedVoiceDraft {
  const clean = transcript.trim();
  const lower = clean.toLowerCase();

  const draft: ParsedVoiceDraft = {
    rawTranscript: clean,
    confidence: 0,
    isVoiceDraft: true,
  };

  if (!clean) return draft;

  // 1. Amount Extraction (handles numbers, "rupees", "rupay", "rs", "₹", "hazar", "thousand")
  // e.g. "500", "500 rupees", "500 rupay", "rs 500", "₹500", "2.5k", "2 thousand"
  let extractedAmount: string | null = null;

  // Check for "k" or "thousand"
  const thousandMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:thousand|hazar|k\b)/);
  if (thousandMatch) {
    const val = parseFloat(thousandMatch[1]) * 1000;
    extractedAmount = String(val);
  } else {
    // Standard digit match
    const numMatch = lower.match(/(?:rs\.?|inr|₹|rupees?|rupay|rupiye)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:rs\.?|inr|₹|rupees?|rupay|rupiye)?/);
    if (numMatch && numMatch[1]) {
      extractedAmount = numMatch[1].replace(/,/g, '');
    }
  }

  if (extractedAmount && !isNaN(Number(extractedAmount)) && Number(extractedAmount) > 0) {
    draft.amount = extractedAmount;
    draft.confidence += 0.35;
  }

  // 2. Type & Category Detection
  const isIncome =
    lower.includes('received') ||
    lower.includes('income') ||
    lower.includes('salary') ||
    lower.includes('mil gaya') ||
    lower.includes('mila') ||
    lower.includes('credited') ||
    lower.includes('cash in');

  const isFood =
    lower.includes('food') ||
    lower.includes('lunch') ||
    lower.includes('dinner') ||
    lower.includes('breakfast') ||
    lower.includes('snack') ||
    lower.includes('chai') ||
    lower.includes('tea') ||
    lower.includes('coffee') ||
    lower.includes('khana') ||
    lower.includes('hotel') ||
    lower.includes('restaurant') ||
    lower.includes('swiggy') ||
    lower.includes('zomato') ||
    lower.includes('grocer') ||
    lower.includes('sabzi') ||
    lower.includes('ration');

  const isRoom =
    lower.includes('room') ||
    lower.includes('rent') ||
    lower.includes('electricity') ||
    lower.includes('bijli') ||
    lower.includes('gas') ||
    lower.includes('cylinder') ||
    lower.includes('kiraya') ||
    lower.includes('wi-fi') ||
    lower.includes('wifi') ||
    lower.includes('water bill');

  const isPeople =
    lower.includes('udhar') ||
    lower.includes('borrow') ||
    lower.includes('lend') ||
    lower.includes('given to') ||
    lower.includes('diye') ||
    lower.includes('liye') ||
    lower.includes('paid to');

  if (isIncome) {
    draft.type = 'income';
    draft.category = 'home';
    draft.subcategory = 'received_salary';
    draft.confidence += 0.35;
  } else if (isFood) {
    draft.type = 'expense';
    draft.category = 'food';
    draft.subcategory = 'dining';
    draft.confidence += 0.35;
  } else if (isRoom) {
    draft.type = 'expense';
    draft.category = 'room';
    draft.subcategory = lower.includes('rent') || lower.includes('kiraya') ? 'rent' : 'electricity';
    draft.confidence += 0.35;
  } else if (isPeople) {
    draft.type = 'expense';
    draft.category = 'people';
    draft.subcategory = 'people_lent';
    draft.confidence += 0.35;

    // Try extracting person name: "Rahul ko 500 diye", "Given 500 to Amit"
    const personMatch =
      clean.match(/(?:to|ko|given to)\s+([A-Za-z]+)/i) ||
      clean.match(/([A-Za-z]+)\s+ko/i);
    if (personMatch && personMatch[1]) {
      draft.personName = personMatch[1].trim();
    }
  } else {
    // Default expense category
    draft.type = 'expense';
    draft.category = 'other';
    draft.subcategory = 'miscellaneous';
    draft.confidence += 0.15;
  }

  // 3. Title Extraction (clean up voice command boilerplate)
  let cleanedTitle = clean
    .replace(/(?:add\s+expense|add\s+income|spent|spend|received|paid|for|on|rupees?|rupay|rs\.?|₹|\d+(?:,\d+)*(?:\.\d+)?)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // If cleaned title is too short, generate a sensible title based on category
  if (!cleanedTitle || cleanedTitle.length < 2) {
    if (isIncome) cleanedTitle = 'Received Money';
    else if (isFood) cleanedTitle = 'Food & Dining';
    else if (isRoom) cleanedTitle = 'Room Expense';
    else if (isPeople && draft.personName) cleanedTitle = `Udhar to ${draft.personName}`;
    else cleanedTitle = 'Quick Expense';
  } else {
    // Capitalize first letter
    cleanedTitle = cleanedTitle.charAt(0).toUpperCase() + cleanedTitle.slice(1);
  }

  draft.title = cleanedTitle;
  draft.notes = `Created via Voice Input: "${clean}"`;

  return draft;
}

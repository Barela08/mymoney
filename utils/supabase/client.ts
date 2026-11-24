import { createBrowserClient } from "@supabase/ssr";

const DEFAULT_SUPABASE_URL = "https://frgrfajnrzqwnevhlrio.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_RHVRSE_Z4R1Qit3djpOfCA_L93zsRjg";

function validHttpUrl(raw?: string): string {
  if (!raw) return "";
  const trimmed = raw.trim().replace(/^['"]+|['"]+$/g, "").trim();
  if (!/^https?:\/\//i.test(trimmed)) return "";
  try {
    const u = new URL(trimmed);
    return u.protocol === "https:" || u.protocol === "http:" ? trimmed : "";
  } catch {
    return "";
  }
}

const supabaseUrl =
  validHttpUrl(typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_SUPABASE_URL : undefined) ||
  validHttpUrl(import.meta.env.VITE_SUPABASE_URL) ||
  DEFAULT_SUPABASE_URL;

const supabaseKey =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  DEFAULT_SUPABASE_KEY;

export const createClient = () =>
  createBrowserClient(
    supabaseUrl,
    supabaseKey
  );

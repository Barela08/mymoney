import crypto from 'crypto';
import { isDatabaseAvailable, query } from './db.js';
import { APP_CONFIG } from './config.js';
import { getEffectiveSupportAlertEmail } from './adminSettingsStore.js';
import {
  DEFAULT_EMAIL_TEMPLATES,
  listEmailTemplatesFallback,
  updateEmailTemplateFallback,
  createEmailTemplateFallback,
  resetEmailTemplateFallback,
  deleteEmailTemplateFallback,
} from './supabaseRestFallback.js';

export interface EmailTemplateRecord {
  id: string;
  slug: string;
  name: string;
  category: string;
  subject: string;
  html_content: string;
  text_content: string;
  variables: string[];
  is_active: boolean;
  is_custom?: boolean;
  is_customized?: boolean;
  version: number;
  created_at?: string;
  updated_at?: string;
}

const URL_VARIABLE_KEYS = new Set([
  'reset_link',
  'invite_link',
  'login_url',
  'action_url',
  'app_url',
  'deep_link',
]);

function escapeHtml(val: unknown): string {
  const str = String(val ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHrefUrl(val: unknown): string {
  const raw = String(val ?? '').trim();
  if (!raw) return '#';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) {
    return raw.replace(/["'<>]/g, '');
  }
  return '#';
}

export function extractTemplateVariables(subject: string, html: string, text: string): string[] {
  const found = new Set<string>();
  const combined = `${subject}\n${html}\n${text}`;
  const regex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(combined)) !== null) {
    if (match[1]) found.add(match[1]);
  }
  return Array.from(found);
}

export async function renderEmailTemplate(
  template: Pick<EmailTemplateRecord, 'subject' | 'html_content' | 'text_content'>,
  variables: Record<string, string | number | boolean | null | undefined> = {}
): Promise<{ subject: string; html: string; text: string }> {
  const supportEmail = await getEffectiveSupportAlertEmail().catch(() => APP_CONFIG.supportEmail);
  const nowStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';

  const baseVars: Record<string, string> = {
    app_name: APP_CONFIG.appName || 'My Money Manager',
    company_name: APP_CONFIG.companyName || 'HackifyPro',
    support_email: supportEmail || APP_CONFIG.supportEmail || 'hackifypro@gmail.com',
    support_phone: APP_CONFIG.supportPhone || '+91 8109923730',
    login_url: APP_CONFIG.appLoginUrl || APP_CONFIG.appBaseUrl || '/',
    app_url: APP_CONFIG.appBaseUrl || '/',
    action_url: APP_CONFIG.appBaseUrl || '/',
    action_text: 'Open My Money Manager',
    date: nowStr,
    submitted_at: nowStr,
    year: String(new Date().getFullYear()),
  };

  for (const [k, v] of Object.entries(variables)) {
    if (v !== undefined && v !== null) {
      baseVars[k] = String(v);
    }
  }

  const replacePlaceholders = (input: string, isHtml: boolean): string => {
    return String(input || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_full, key: string) => {
      if (!(key in baseVars)) {
        return '';
      }
      const raw = baseVars[key];
      if (!isHtml) return raw;
      if (URL_VARIABLE_KEYS.has(key)) {
        return sanitizeHrefUrl(raw);
      }
      return escapeHtml(raw).replace(/\r?\n/g, '<br/>');
    });
  };

  return {
    subject: replacePlaceholders(template.subject, false).replace(/[\r\n]/g, ' ').trim(),
    html: replacePlaceholders(template.html_content, true),
    text: replacePlaceholders(template.text_content || '', false),
  };
}

export async function listEmailTemplates(): Promise<EmailTemplateRecord[]> {
  const map = new Map<string, EmailTemplateRecord>();
  const defaultSlugs = new Set(DEFAULT_EMAIL_TEMPLATES.map((t) => t.slug));

  for (const def of DEFAULT_EMAIL_TEMPLATES) {
    map.set(def.slug, { ...def, is_custom: false, is_customized: false });
  }

  const fbRows = await listEmailTemplatesFallback();
  for (const row of fbRows) {
    if (!row?.slug) continue;
    const def = map.get(row.slug);
    map.set(row.slug, {
      ...def,
      ...row,
      variables: Array.isArray(row.variables) ? row.variables : (def?.variables || []),
      is_custom: !defaultSlugs.has(row.slug),
      is_customized: Boolean(row.is_customized ?? Number(row.version || 1) > 1),
    });
  }

  if (isDatabaseAvailable()) {
    try {
      const res = await query('SELECT * FROM public.email_templates ORDER BY category, name ASC');
      for (const row of res.rows || []) {
        if (!row?.slug) continue;
        const def = map.get(row.slug);
        map.set(row.slug, {
          ...def,
          ...row,
          variables: Array.isArray(row.variables) ? row.variables : (def?.variables || []),
          is_custom: !defaultSlugs.has(row.slug),
          is_customized: Boolean(def ? Number(row.version || 1) > 1 : true),
        });
      }
    } catch {
      // Fallback already populated
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    `${a.category || ''}:${a.name || ''}`.localeCompare(`${b.category || ''}:${b.name || ''}`)
  );
}

export async function getEmailTemplateByIdOrSlug(idOrSlug: string): Promise<EmailTemplateRecord | null> {
  const key = String(idOrSlug || '').trim();
  if (!key) return null;
  const all = await listEmailTemplates();
  return all.find((t) => t.id === key || t.slug === key) || null;
}

export async function getRenderedCustomTemplateIfActive(
  slug: string,
  variables: Record<string, string | number | boolean | null | undefined>
): Promise<{ subject: string; html: string; text: string } | null> {
  try {
    const tmpl = await getEmailTemplateByIdOrSlug(slug);
    if (!tmpl || !tmpl.is_active) return null;
    if (!tmpl.is_customized && !tmpl.is_custom && Number(tmpl.version || 1) <= 1) {
      return null;
    }
    return await renderEmailTemplate(tmpl, variables);
  } catch {
    return null;
  }
}

export async function saveEmailTemplate(
  id: string,
  updates: {
    name?: string;
    category?: string;
    subject?: string;
    html_content?: string;
    text_content?: string;
    variables?: string[];
    is_active?: boolean;
  }
): Promise<EmailTemplateRecord | null> {
  const existing = await getEmailTemplateByIdOrSlug(id);
  if (!existing) return null;

  const nextSubject = updates.subject !== undefined ? String(updates.subject).trim() : existing.subject;
  const nextHtml = updates.html_content !== undefined ? String(updates.html_content) : existing.html_content;
  const nextText = updates.text_content !== undefined ? String(updates.text_content) : existing.text_content;
  const nextName = updates.name !== undefined ? String(updates.name).trim() : existing.name;
  const nextCategory = updates.category !== undefined ? String(updates.category).trim().toLowerCase() : existing.category;
  const nextActive = updates.is_active !== undefined ? Boolean(updates.is_active) : existing.is_active;

  const detectedVars = extractTemplateVariables(nextSubject, nextHtml, nextText);
  const nextVars = Array.isArray(updates.variables) && updates.variables.length > 0
    ? Array.from(new Set([...updates.variables, ...detectedVars]))
    : Array.from(new Set([...(existing.variables || []), ...detectedVars]));

  if (isDatabaseAvailable()) {
    try {
      const upRes = await query(
        `UPDATE public.email_templates
         SET name = $1,
             category = $2,
             subject = $3,
             html_content = $4,
             text_content = $5,
             variables = $6::jsonb,
             is_active = $7,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $8 OR slug = $9
         RETURNING *`,
        [
          nextName,
          nextCategory,
          nextSubject,
          nextHtml,
          nextText,
          JSON.stringify(nextVars),
          nextActive,
          existing.id,
          existing.slug,
        ]
      );
      if (upRes.rows.length === 0) {
        await query(
          `INSERT INTO public.email_templates (slug, name, category, subject, html_content, text_content, variables, is_active, version)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 2)
           ON CONFLICT (slug) DO UPDATE SET
             name = EXCLUDED.name,
             category = EXCLUDED.category,
             subject = EXCLUDED.subject,
             html_content = EXCLUDED.html_content,
             text_content = EXCLUDED.text_content,
             variables = EXCLUDED.variables,
             is_active = EXCLUDED.is_active,
             version = public.email_templates.version + 1,
             updated_at = NOW()`,
          [
            existing.slug,
            nextName,
            nextCategory,
            nextSubject,
            nextHtml,
            nextText,
            JSON.stringify(nextVars),
            nextActive,
          ]
        );
      }
    } catch (err: any) {
      console.warn('[EmailTemplateService] PG update fallback notice:', err?.message);
    }
  }

  const fbUpdated = await updateEmailTemplateFallback(existing.id, {
    name: nextName,
    category: nextCategory,
    subject: nextSubject,
    html_content: nextHtml,
    text_content: nextText,
    variables: nextVars,
    is_active: nextActive,
  });

  return fbUpdated || (await getEmailTemplateByIdOrSlug(existing.id));
}

export async function createCustomEmailTemplate(input: {
  name: string;
  slug?: string;
  category?: string;
  subject: string;
  html_content: string;
  text_content?: string;
  variables?: string[];
  is_active?: boolean;
}): Promise<EmailTemplateRecord> {
  const cleanName = String(input.name || '').trim();
  if (!cleanName) throw new Error('Template name is required.');
  const rawSlug = String(input.slug || cleanName)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!rawSlug) throw new Error('A valid template slug is required.');

  const existingAll = await listEmailTemplates();
  const uniqueSlug = existingAll.some((t) => t.slug === rawSlug)
    ? `${rawSlug}-${crypto.randomBytes(2).toString('hex')}`
    : rawSlug;

  const subject = String(input.subject || '').trim();
  const html = String(input.html_content || '').trim();
  if (!subject || !html) {
    throw new Error('Subject and HTML body are required.');
  }
  const text = String(input.text_content || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  const detectedVars = extractTemplateVariables(subject, html, text);
  const variables = Array.from(new Set([...(input.variables || []), ...detectedVars]));
  const category = String(input.category || 'custom').trim().toLowerCase() || 'custom';
  const isActive = input.is_active !== false;

  let pgId: string | undefined;
  if (isDatabaseAvailable()) {
    try {
      const insRes = await query(
        `INSERT INTO public.email_templates (slug, name, category, subject, html_content, text_content, variables, is_active, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 1)
         RETURNING id`,
        [uniqueSlug, cleanName, category, subject, html, text, JSON.stringify(variables), isActive]
      );
      pgId = insRes.rows[0]?.id;
    } catch (err: any) {
      console.warn('[EmailTemplateService] PG create notice:', err?.message);
    }
  }

  return await createEmailTemplateFallback({
    id: pgId,
    slug: uniqueSlug,
    name: cleanName,
    category,
    subject,
    html_content: html,
    text_content: text,
    variables,
    is_active: isActive,
  });
}

export async function resetEmailTemplate(id: string): Promise<EmailTemplateRecord | null> {
  const def = DEFAULT_EMAIL_TEMPLATES.find((t) => t.id === id || t.slug === id);
  if (!def) return null;

  if (isDatabaseAvailable()) {
    try {
      await query(
        `UPDATE public.email_templates
         SET name = $1,
             category = $2,
             subject = $3,
             html_content = $4,
             text_content = $5,
             variables = $6::jsonb,
             is_active = TRUE,
             version = 1,
             updated_at = NOW()
         WHERE id = $7 OR slug = $8`,
        [
          def.name,
          def.category,
          def.subject,
          def.html_content,
          def.text_content,
          JSON.stringify(def.variables),
          def.id,
          def.slug,
        ]
      );
    } catch {
      // ignore
    }
  }

  return await resetEmailTemplateFallback(def.id);
}

export async function deleteCustomEmailTemplate(id: string): Promise<boolean> {
  const existing = await getEmailTemplateByIdOrSlug(id);
  if (!existing || !existing.is_custom) {
    return false;
  }

  if (isDatabaseAvailable()) {
    try {
      await query(`DELETE FROM public.email_templates WHERE id = $1 OR slug = $2`, [
        existing.id,
        existing.slug,
      ]);
    } catch {
      // ignore
    }
  }

  return await deleteEmailTemplateFallback(existing.id);
}

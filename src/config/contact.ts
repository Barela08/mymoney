/**
 * Official HackifyPro Support & Contact Configuration
 * Single Source of Truth for My Money Manager across mobile, desktop, and web views.
 */

export const SUPPORT_CONTACT = {
  companyName: 'HackifyPro',
  appName: 'My Money Manager',
  phone: '+917414935405',
  displayPhone: '+91 74149 35405',
  rawPhone: '7414935405',
  email: 'hackifypro@gmail.com',
  whatsappNumber: '917414935405',
  whatsappUrl:
    'https://wa.me/917414935405?text=Hello%20HackifyPro%20Support%20Team%2C%0A%0AI%20need%20assistance%20regarding%20My%20Money%20Manager%20app.%20I%20have%20a%20query%20and%20would%20like%20some%20help.%0A%0APlease%20guide%20me%20regarding%20my%20issue.%0A%0AThank%20you.',
  mailToUrl:
    'mailto:hackifypro@gmail.com?subject=My%20Money%20Manager%20%E2%80%93%20Support%20Request',
  telUrl: 'tel:+917414935405',
  prefilledWhatsAppMessage:
    'Hello HackifyPro Support Team,\n\nI need assistance regarding My Money Manager app. I have a query and would like some help.\n\nPlease guide me regarding my issue.\n\nThank you.',
  defaultSubject: 'My Money Manager – Support Request',
  operatingHours: 'Monday – Saturday, 10:00 AM – 6:00 PM IST',
} as const;

export type SupportContact = typeof SUPPORT_CONTACT;

/**
 * Builds a WhatsApp deep link with custom message while defaulting to official contact number
 */
export function buildWhatsAppSupportUrl(customMessage?: string): string {
  if (!customMessage || !customMessage.trim()) {
    return SUPPORT_CONTACT.whatsappUrl;
  }
  return `https://wa.me/${SUPPORT_CONTACT.whatsappNumber}?text=${encodeURIComponent(customMessage.trim())}`;
}

/**
 * Builds a mailto link with optional custom subject and body
 */
export function buildMailToUrl(subject?: string, body?: string): string {
  const params: string[] = [];
  params.push(`subject=${encodeURIComponent(subject || SUPPORT_CONTACT.defaultSubject)}`);
  if (body) {
    params.push(`body=${encodeURIComponent(body)}`);
  }
  return `mailto:${SUPPORT_CONTACT.email}?${params.join('&')}`;
}

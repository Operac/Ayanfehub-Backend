/**
 * notificationService.ts — Resend-powered emails for approval workflows and
 * admin-created accounts. Falls back to console.log when RESEND_API_KEY is not set.
 */
import logger from '../utils/logger';

let resendClient: any = null;
function getResend() {
  if (!resendClient && process.env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

const FROM = process.env.RESEND_FROM_EMAIL ?? 'Ayanfe Hub <hello@ayanfehub.com>';
const APP_NAME = 'Ayanfe Hub';

async function send(to: string, subject: string, html: string): Promise<void> {
  const resend = getResend();
  if (!resend) {
    logger.info('[NOTIF-EMAIL-PLACEHOLDER]', { to, subject });
    return;
  }
  try {
    const { error } = await resend.emails.send({ from: FROM, to, subject, html });
    if (error) logger.error('[NOTIF-EMAIL] Resend error', { error, to });
    else logger.info('[NOTIF-EMAIL] Sent', { to, subject });
  } catch (err) {
    logger.error('[NOTIF-EMAIL] Failed', { err, to });
  }
}

// ── Shared HTML layout ────────────────────────────────────────────────────────

function wrap(body: string) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
  <tr><td style="background:#16a34a;padding:24px 32px">
    <span style="color:#fff;font-size:20px;font-weight:700">${APP_NAME}</span>
  </td></tr>
  <tr><td style="padding:32px">${body}</td></tr>
  <tr><td style="padding:16px 32px;background:#f9fafb;text-align:center;font-size:12px;color:#6b7280">
    © ${new Date().getFullYear()} ${APP_NAME} · Lagos, Nigeria
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

// ── Product approval emails ───────────────────────────────────────────────────

export class NotificationService {
  /**
   * Notify vendor when their product is approved.
   * @param vendorEmail  email of the vendor user
   * @param productName  product that was approved
   */
  static async notifyProductApproved(vendorEmail: string | null | undefined, productName: string): Promise<void> {
    logger.info('[APPROVAL] Product approved', { vendorEmail, productName });

    if (!vendorEmail) return;

    const html = wrap(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:22px">Your product is live! 🎉</h2>
      <p style="color:#374151;margin:0 0 12px">Great news — your product listing has been approved by the ${APP_NAME} team and is now visible to customers.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin:20px 0">
        <p style="margin:0;color:#15803d;font-weight:600;font-size:16px">📦 ${productName}</p>
        <p style="margin:6px 0 0;color:#166534;font-size:14px">Status: <strong>Approved &amp; Live</strong></p>
      </div>
      <p style="color:#374151;margin:0 0 20px">Customers can now find and order your product on the marketplace. Keep your stock up to date and we'll handle the rest!</p>
      <p style="color:#6b7280;font-size:14px;margin:0">Need help? Reply to this email or contact our support team.</p>
    `);

    await send(vendorEmail, `✅ Your product "${productName}" is now live on ${APP_NAME}`, html);
  }

  /**
   * Notify vendor when their product is rejected.
   */
  static async notifyProductRejected(
    vendorEmail: string | null | undefined,
    productName: string,
    reason: string
  ): Promise<void> {
    logger.info('[APPROVAL] Product rejected', { vendorEmail, productName, reason });

    if (!vendorEmail) return;

    const html = wrap(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:22px">Product listing needs revision</h2>
      <p style="color:#374151;margin:0 0 12px">We reviewed your product listing and couldn't approve it at this time. Here are the details:</p>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px 20px;margin:20px 0">
        <p style="margin:0;color:#b91c1c;font-weight:600;font-size:16px">📦 ${productName}</p>
        <p style="margin:6px 0 0;color:#991b1b;font-size:14px">Status: <strong>Rejected</strong></p>
        <p style="margin:10px 0 0;color:#7f1d1d;font-size:14px"><strong>Reason:</strong> ${reason}</p>
      </div>
      <p style="color:#374151;margin:0 0 12px">Please update your listing based on the feedback above and re-submit for review. Common fixes include:</p>
      <ul style="color:#374151;margin:0 0 20px;padding-left:20px">
        <li>Clear, accurate product name and description</li>
        <li>Correct unit and category selection</li>
        <li>Reasonable pricing in NGN</li>
      </ul>
      <p style="color:#6b7280;font-size:14px;margin:0">Questions? Contact us and we'll help you get your product approved quickly.</p>
    `);

    await send(vendorEmail, `Product listing update needed: "${productName}"`, html);
  }

  /**
   * Welcome email when admin creates a new vendor account.
   */
  static async notifyVendorCreated(
    email: string | null | undefined,
    fullName: string,
    businessName: string,
    tempPassword?: string
  ): Promise<void> {
    logger.info('[ACCOUNT] Vendor created', { email, businessName });

    if (!email) return;

    const credentialsBlock = tempPassword
      ? `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px 20px;margin:20px 0">
           <p style="margin:0;color:#0c4a6e;font-weight:600">Your login credentials</p>
           <p style="margin:6px 0 0;color:#0369a1;font-size:14px">Email: <strong>${email}</strong></p>
           <p style="margin:4px 0 0;color:#0369a1;font-size:14px">Temporary Password: <strong>${tempPassword}</strong></p>
           <p style="margin:10px 0 0;color:#075985;font-size:13px">⚠️ Please change your password after your first login.</p>
         </div>`
      : '';

    const html = wrap(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:22px">Welcome to ${APP_NAME}, ${fullName}! 🛍️</h2>
      <p style="color:#374151;margin:0 0 12px">Your vendor account for <strong>${businessName}</strong> has been set up by the ${APP_NAME} team. You can now start listing products on our marketplace.</p>
      ${credentialsBlock}
      <p style="color:#374151;margin:0 0 12px">As a vendor you can:</p>
      <ul style="color:#374151;margin:0 0 20px;padding-left:20px">
        <li>Upload products for admin review</li>
        <li>Track orders for your products</li>
        <li>View your sales performance</li>
      </ul>
      <p style="color:#6b7280;font-size:14px;margin:0">Our team is here to help you grow. Reach out anytime.</p>
    `);

    await send(email, `Welcome to ${APP_NAME} — Your vendor account is ready`, html);
  }

  /**
   * Welcome email when admin creates a new artisan account.
   */
  static async notifyArtisanCreated(
    email: string | null | undefined,
    fullName: string,
    artisanName: string,
    category: string,
    tempPassword?: string
  ): Promise<void> {
    logger.info('[ACCOUNT] Artisan created', { email, artisanName, category });

    if (!email) return;

    const credentialsBlock = tempPassword
      ? `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px 20px;margin:20px 0">
           <p style="margin:0;color:#0c4a6e;font-weight:600">Your login credentials</p>
           <p style="margin:6px 0 0;color:#0369a1;font-size:14px">Email: <strong>${email}</strong></p>
           <p style="margin:4px 0 0;color:#0369a1;font-size:14px">Temporary Password: <strong>${tempPassword}</strong></p>
           <p style="margin:10px 0 0;color:#075985;font-size:13px">⚠️ Please change your password after your first login.</p>
         </div>`
      : '';

    const html = wrap(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:22px">Welcome to ${APP_NAME}, ${fullName}! ✨</h2>
      <p style="color:#374151;margin:0 0 12px">Your artisan profile for <strong>${artisanName}</strong> (${category}) has been created. You are now part of our network of skilled artisans.</p>
      ${credentialsBlock}
      <p style="color:#374151;margin:0 0 12px">As an artisan you can:</p>
      <ul style="color:#374151;margin:0 0 20px;padding-left:20px">
        <li>Manage your services and pricing</li>
        <li>Receive and track bookings</li>
        <li>Build your reputation through client reviews</li>
      </ul>
      <p style="color:#6b7280;font-size:14px;margin:0">We're glad to have you! Our team will be in touch to help you get started.</p>
    `);

    await send(email, `Welcome to ${APP_NAME} — Your artisan profile is live`, html);
  }

  /**
   * Welcome email when admin creates a new shortlet manager account.
   */
  static async notifyShortletCreated(
    email: string | null | undefined,
    fullName: string,
    shortletName: string,
    tempPassword?: string
  ): Promise<void> {
    logger.info('[ACCOUNT] Shortlet manager created', { email, shortletName });

    if (!email) return;

    const credentialsBlock = tempPassword
      ? `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px 20px;margin:20px 0">
           <p style="margin:0;color:#0c4a6e;font-weight:600">Your login credentials</p>
           <p style="margin:6px 0 0;color:#0369a1;font-size:14px">Email: <strong>${email}</strong></p>
           <p style="margin:4px 0 0;color:#0369a1;font-size:14px">Temporary Password: <strong>${tempPassword}</strong></p>
           <p style="margin:10px 0 0;color:#075985;font-size:13px">⚠️ Please change your password after your first login.</p>
         </div>`
      : '';

    const html = wrap(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:22px">Welcome to ${APP_NAME}, ${fullName}! 🏠</h2>
      <p style="color:#374151;margin:0 0 12px">Your shortlet listing <strong>${shortletName}</strong> has been created and is now part of the ${APP_NAME} platform.</p>
      ${credentialsBlock}
      <p style="color:#6b7280;font-size:14px;margin:0">Our team will be in touch with next steps for verifying and publishing your listing.</p>
    `);

    await send(email, `Welcome to ${APP_NAME} — Your shortlet is listed`, html);
  }

  /**
   * Internal audit log for approval actions (always console, never email).
   */
  static logApprovalAction(
    action: string,
    productId: string,
    adminId: string,
    details?: Record<string, any>
  ): void {
    logger.info(`[APPROVAL_LOG] ${action}`, { productId, adminId, ...details });
  }
}

export default NotificationService;

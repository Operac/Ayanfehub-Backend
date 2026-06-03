/**
 * emailService.ts — Resend-powered transactional emails for cleaning service flows.
 * Falls back to structured console.log when RESEND_API_KEY is not set.
 */
import logger from '../utils/logger';

// Lazy-load Resend so the app doesn't crash if the key is missing
let resendClient: any = null;
function getResend() {
  if (!resendClient && process.env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL ?? 'Ayanfe Hub <hello@ayanfehub.com>';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function send(to: string, subject: string, html: string): Promise<void> {
  const resend = getResend();
  if (!resend) {
    logger.info('[EMAIL-PLACEHOLDER] Would send email', { to, subject });
    return;
  }
  try {
    const { error } = await resend.emails.send({ from: FROM_ADDRESS, to, subject, html });
    if (error) logger.error('[EMAIL] Resend error', { error, to, subject });
    else logger.info('[EMAIL] Sent', { to, subject });
  } catch (err: any) {
    logger.error('[EMAIL] Failed to send', { err: err.message, to, subject });
  }
}

function formatNgn(amount: number): string {
  return `₦${amount.toLocaleString('en-NG')}`;
}

function baseLayout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f6f8; margin: 0; padding: 32px 16px; }
  .card { background: #fff; border-radius: 12px; max-width: 560px; margin: 0 auto; padding: 36px 32px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  h1 { font-size: 22px; color: #1a1a2e; margin: 0 0 6px; }
  .sub { color: #6b7280; font-size: 13px; margin: 0 0 24px; }
  .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
  .info-row:last-child { border-bottom: none; }
  .info-label { color: #6b7280; }
  .info-value { font-weight: 600; color: #1a1a2e; }
  .highlight { background: #fff7ed; border-left: 4px solid #f97316; border-radius: 4px; padding: 12px 16px; margin: 20px 0; font-size: 14px; color: #92400e; }
  .btn { display: inline-block; background: #f97316; color: #fff; text-decoration: none; border-radius: 8px; padding: 12px 24px; font-weight: 700; font-size: 14px; margin-top: 20px; }
  .footer { text-align: center; color: #9ca3af; font-size: 12px; margin-top: 32px; }
</style>
</head>
<body>
  <div class="card">
    ${body}
    <div class="footer">© ${new Date().getFullYear()} Ayanfe Hub · Lagos, Nigeria</div>
  </div>
</body>
</html>`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Quote sent to customer after admin reviews the request */
export async function sendQuoteEmail(opts: {
  to: string;
  customerName: string | null;
  requestNumber: string;
  category: string;
  quoteAmountNgn: number;
  depositAmountNgn: number;
  quoteNotes?: string | null;
  appUrl?: string;
}): Promise<void> {
  const name = opts.customerName ?? 'Customer';
  const appUrl = opts.appUrl ?? 'https://ayanfehub.com/orders';
  const body = `
    <h1>Your Cleaning Quote is Ready 🧹</h1>
    <p class="sub">Hi ${name}, we've reviewed your ${opts.category.toLowerCase()} cleaning request.</p>
    <div class="info-row"><span class="info-label">Request #</span><span class="info-value">${opts.requestNumber}</span></div>
    <div class="info-row"><span class="info-label">Total Quote</span><span class="info-value">${formatNgn(opts.quoteAmountNgn)}</span></div>
    <div class="info-row"><span class="info-label">Deposit Required</span><span class="info-value">${formatNgn(opts.depositAmountNgn)}</span></div>
    ${opts.quoteNotes ? `<div class="highlight">${opts.quoteNotes}</div>` : ''}
    <p style="font-size:14px;color:#374151">To confirm your booking, please pay the deposit of <strong>${formatNgn(opts.depositAmountNgn)}</strong> through the Ayanfe Hub app.</p>
    <a href="${appUrl}" class="btn">View Quote &amp; Pay Deposit</a>
  `;
  await send(opts.to, `Your Cleaning Quote — ${opts.requestNumber}`, baseLayout('Your Cleaning Quote', body));
}

/** Notification that an in-person inspection has been scheduled */
export async function sendInspectionScheduledEmail(opts: {
  to: string;
  customerName: string | null;
  requestNumber: string;
  category: string;
  inspectionDate: Date;
  inspectionNote?: string | null;
  contactPersonName?: string | null;
  contactPersonPhone?: string | null;
  appUrl?: string;
}): Promise<void> {
  const name = opts.customerName ?? 'Customer';
  const dateStr = opts.inspectionDate.toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = opts.inspectionDate.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
  const body = `
    <h1>Inspection Scheduled 📋</h1>
    <p class="sub">Hi ${name}, we've scheduled an on-site inspection for your ${opts.category.toLowerCase()} cleaning request.</p>
    <div class="info-row"><span class="info-label">Request #</span><span class="info-value">${opts.requestNumber}</span></div>
    <div class="info-row"><span class="info-label">Inspection Date</span><span class="info-value">${dateStr}</span></div>
    <div class="info-row"><span class="info-label">Time</span><span class="info-value">${timeStr}</span></div>
    ${opts.contactPersonName ? `<div class="info-row"><span class="info-label">Contact Person on Site</span><span class="info-value">${opts.contactPersonName}${opts.contactPersonPhone ? ` · ${opts.contactPersonPhone}` : ''}</span></div>` : ''}
    ${opts.inspectionNote ? `<div class="highlight">${opts.inspectionNote}</div>` : ''}
    <p style="font-size:14px;color:#374151">Our team will visit your site to assess the scope of work. You'll receive a detailed quote within 24 hours of the inspection.</p>
  `;
  await send(opts.to, `Inspection Scheduled — ${opts.requestNumber}`, baseLayout('Inspection Scheduled', body));
}

/** Sent when the cleaning job is marked as COMPLETED */
export async function sendCompletionEmail(opts: {
  to: string;
  customerName: string | null;
  requestNumber: string;
  handoverNote?: string | null;
  appUrl?: string;
}): Promise<void> {
  const name = opts.customerName ?? 'Customer';
  const appUrl = opts.appUrl ?? 'https://ayanfehub.com/orders';
  const body = `
    <h1>Cleaning Completed! 🎉</h1>
    <p class="sub">Hi ${name}, your property has been cleaned and is ready for handover.</p>
    <div class="info-row"><span class="info-label">Request #</span><span class="info-value">${opts.requestNumber}</span></div>
    ${opts.handoverNote ? `<div class="highlight">${opts.handoverNote}</div>` : ''}
    <p style="font-size:14px;color:#374151">We hope everything looks great! Please leave a review to help us improve our service.</p>
    <a href="${appUrl}" class="btn">Rate Your Experience</a>
  `;
  await send(opts.to, `Cleaning Completed — ${opts.requestNumber}`, baseLayout('Cleaning Completed', body));
}

/** Sent when admin deposits confirmation is processed */
export async function sendDepositConfirmedEmail(opts: {
  to: string;
  customerName: string | null;
  requestNumber: string;
  depositAmountNgn: number;
}): Promise<void> {
  const name = opts.customerName ?? 'Customer';
  const body = `
    <h1>Deposit Received ✅</h1>
    <p class="sub">Hi ${name}, we've confirmed your deposit for request ${opts.requestNumber}.</p>
    <div class="info-row"><span class="info-label">Request #</span><span class="info-value">${opts.requestNumber}</span></div>
    <div class="info-row"><span class="info-label">Deposit Paid</span><span class="info-value">${formatNgn(opts.depositAmountNgn)}</span></div>
    <p style="font-size:14px;color:#374151">We're assigning a cleaning crew to your job. You'll receive another notification when a cleaner is assigned.</p>
  `;
  await send(opts.to, `Deposit Confirmed — ${opts.requestNumber}`, baseLayout('Deposit Confirmed', body));
}

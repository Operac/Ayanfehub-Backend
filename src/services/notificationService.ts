// Notification Service for product approval, vendor/artisan creation, etc.
// Initial implementation: Console logging
// Extensible for email (SendGrid) and WhatsApp (Twilio) in future phases

export class NotificationService {
  /**
   * Notify vendor when their product is approved
   */
  static notifyProductApproved(vendorId: string, productName: string): void {
    const message = `[NOTIFICATION] Product Approved: Vendor ${vendorId} - "${productName}" is now visible to customers`;
    console.log(message);
    // TODO: Extend with email/WhatsApp in Phase 4
  }

  /**
   * Notify vendor when their product is rejected
   */
  static notifyProductRejected(vendorId: string, productName: string, reason: string): void {
    const message = `[NOTIFICATION] Product Rejected: Vendor ${vendorId} - "${productName}" was rejected. Reason: ${reason}`;
    console.log(message);
    // TODO: Extend with email/WhatsApp in Phase 4
  }

  /**
   * Notify newly created vendor (created by admin)
   */
  static notifyVendorCreated(userId: string, email: string, password?: string): void {
    const message = `[NOTIFICATION] Vendor Created: User ${userId} (${email}) has been created as a vendor${password ? ` with password: ${password}` : ''}`;
    console.log(message);
    // TODO: Send welcome email with credentials/onboarding info
    // TODO: Extend with WhatsApp notifications
  }

  /**
   * Notify newly created artisan (created by admin)
   */
  static notifyArtisanCreated(userId: string, email: string, password?: string): void {
    const message = `[NOTIFICATION] Artisan Created: User ${userId} (${email}) has been created as an artisan${password ? ` with password: ${password}` : ''}`;
    console.log(message);
    // TODO: Send welcome email with credentials/onboarding info
    // TODO: Extend with WhatsApp notifications
  }

  /**
   * Notify newly created shortlet owner (created by admin)
   */
  static notifyShortletCreated(userId: string, email: string, shortletName: string, password?: string): void {
    const message = `[NOTIFICATION] Shortlet Created: User ${userId} (${email}) is now managing "${shortletName}"${password ? ` with password: ${password}` : ''}`;
    console.log(message);
    // TODO: Send welcome email with credentials/onboarding info
  }

  /**
   * Internal logging for approval workflows
   */
  static logApprovalAction(action: string, productId: string, adminId: string, details?: Record<string, any>): void {
    const message = `[APPROVAL_LOG] ${action}: Product ${productId} by Admin ${adminId}`;
    console.log(message, details || '');
  }
}

export default NotificationService;

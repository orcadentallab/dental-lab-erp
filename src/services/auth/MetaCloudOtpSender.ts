import type { OtpSender, OtpSendResult } from './types';

/** Server delivery must be implemented before enabling WhatsApp authentication. */
export class MetaCloudOtpSender implements OtpSender {
    async sendOtp(): Promise<OtpSendResult> {
        return { success: false, channel: 'whatsapp', error: 'SERVER_OTP_DELIVERY_NOT_CONFIGURED' };
    }
}

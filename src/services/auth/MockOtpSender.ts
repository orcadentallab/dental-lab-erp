import type { OtpSender, OtpSendResult } from './types';

/**
 * MockOtpSender: Used during local development and testing.
 * Prints the OTP to the console and simulates immediate delivery.
 */
export class MockOtpSender implements OtpSender {
    async sendOtp(phone: string, code: string): Promise<OtpSendResult> {
        if (import.meta.env.DEV) {
            console.log(`%c[MOCK OTP SENDER] Phone: ${phone} | Code: ${code}`, 'color: #2563eb; font-weight: bold; font-size: 14px;');
        }
        return {
            success: true,
            channel: 'mock',
            messageId: `mock_${Date.now()}`
        };
    }
}

export type OtpChannel = 'whatsapp' | 'sms' | 'mock';

export interface OtpSendResult {
    success: boolean;
    messageId?: string;
    channel: OtpChannel;
    error?: string;
}

export interface OtpSender {
    sendOtp(phone: string, code: string): Promise<OtpSendResult>;
}

export interface NewDoctorProfile {
    name: string;
    address: string;
    isCenter: boolean;
    codeRegion: import('../../lib/doctorIdentity').DoctorCodeRegion | '';
    branches: { name: string; address: string; phone: string; phoneOwnerRole?: import('../../lib/doctorContacts').PhoneOwnerRole; phoneOwnerName?: string; phoneHasWhatsapp?: boolean }[];
    doctors: { name: string; phone: string; phoneHasWhatsapp?: boolean }[];
    contactPhones?: import('../../lib/doctorContacts').DoctorContactPhone[];
    addressChangeRequested?: boolean;
    requestedAddress?: string;
}

export interface RequestOtpResponse {
    success: boolean;
    normalized_phone?: string;
    channel?: OtpChannel;
    expires_in_seconds?: number;
    otp_code?: string; // Only populated when channel is 'mock'
    message?: string;
    error_code?: string;
}

export type DoctorAuthStatus =
    | 'auto_linked'
    | 'pending_approval'
    | 'not_found'
    | 'deactivated'
    | 'wrong_code'
    | 'expired_code'
    | 'max_attempts_exceeded'
    | 'invalid_phone';

export interface VerifyDoctorAuthResponse {
    success: boolean;
    status: DoctorAuthStatus;
    message?: string;
    doctor_id?: string;
    doctor_name?: string;
    doctor_code?: string;
    email?: string;
    session_token?: string;
    normalized_phone?: string;
    claim_token?: string;
    attempts_left?: number;
    reason?: 'center_or_branch' | 'multi_match';
}

export interface ClaimDoctorCodeResponse {
    success: boolean;
    status?: 'pending_approval';
    message: string;
}

export interface DoctorLinkRequestItem {
    password_registration?: boolean;
    account_email?: string;
    address_update?: boolean;
    address_update_id?: string;
    manual_access?: boolean;
    profile?: { name?: string; address?: string; code_region?: string; is_center?: boolean; branches?: NewDoctorProfile['branches']; contact_phones?: NewDoctorProfile['contactPhones']; address_change_requested?: boolean; requested_address?: string; doctors?: { name: string; phone: string }[] };
    id: string;
    phone: string;
    normalized_phone: string;
    claimed_doctor_code: string | null;
    request_type: 'multi_match' | 'center_shared' | 'code_claim' | 'new_doctor';
    status: 'pending' | 'approved' | 'rejected';
    notes: string | null;
    target_doctor_id: string | null;
    target_doctor_name: string | null;
    target_doctor_code: string | null;
    matched_doctor_ids: string[];
    created_at: string;
}

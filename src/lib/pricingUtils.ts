import type { Doctor, Service } from '../services/db';

export function getPricingDoctor(doctor: Doctor | undefined | null, doctors: Doctor[]): Doctor | undefined {
    if (!doctor) return undefined;
    if (!doctor.parentId) return doctor;
    return doctors.find(d => d.id === doctor.parentId) || doctor;
}

export function getDoctorServicePrice(
    serviceName: string,
    service: Service | undefined,
    doctor: Doctor | undefined | null,
    doctors: Doctor[]
): number {
    const pricingDoctor = getPricingDoctor(doctor, doctors);
    return pricingDoctor?.customPrices?.[serviceName] ?? service?.sellingPrice ?? 0;
}

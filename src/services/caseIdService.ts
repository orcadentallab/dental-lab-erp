import { type Doctor, db } from './db';
import { generateCaseId, getCaseIdYearRange } from '../utils/caseId';

function resolveCaseOwner(doctor: Doctor, doctors: Doctor[]) {
    const ownerDoctor = doctor.parentId
        ? doctors.find(d => d.id === doctor.parentId) || doctor
        : doctor;

    const relatedDoctorIds = ownerDoctor.isCenter
        ? [
            ownerDoctor.id,
            ...doctors
                .filter(d => d.parentId === ownerDoctor.id)
                .map(d => d.id),
        ]
        : [doctor.id];

    return {
        ownerDoctor,
        relatedDoctorIds: Array.from(new Set(relatedDoctorIds.filter(Boolean))),
    };
}

async function getNextYearlySequence(doctorIds: string[], date = new Date()): Promise<number> {
    const { startDate, endDate } = getCaseIdYearRange(date);
    const counts = await Promise.all(
        doctorIds.map(async doctorId => {
            const result = await db.getOrders(1, 1, {
                doctorId,
                startDate,
                endDate,
                includeArchived: true,
            });
            return result.count;
        })
    );

    return counts.reduce((sum, count) => sum + count, 0) + 1;
}

export async function generateNextCaseIdForDoctor(
    doctor: Doctor,
    doctors: Doctor[],
    date = new Date()
): Promise<string> {
    const { ownerDoctor, relatedDoctorIds } = resolveCaseOwner(doctor, doctors);
    const yearlySequence = await getNextYearlySequence(relatedDoctorIds, date);
    return generateCaseId(ownerDoctor.doctorCode || 'UKN', yearlySequence, date);
}

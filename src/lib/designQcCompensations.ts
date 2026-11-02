import type {Order} from '../services/db';
import type {QcCompensation} from '../services/supabase/designQc';
/** Financial-only projection consumed by statements/exports, never workflows. */
export function designQcCompensationRows(rows:QcCompensation[]):Order[] {
 return rows.map(r=>({id:`qc-contribution-${r.id}`,caseId:`${r.caseId} — تصميم سابق`,doctorId:'',patientName:'مساهمة تصميم مسوّاة',items:[],discount:0,totalPrice:0,cost:0,shade:'',status:'Under Design',productionStatus:'designing',issueState:'none',intakeState:'accepted',workflowType:'split',designStatus:'completed',designerId:r.designerId,designPrice:Number(r.amount),manualDesignPrice:Number(r.amount),createdAt:r.date,deliveryDate:r.date,priority:'Normal'}));
}

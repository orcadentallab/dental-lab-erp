/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect } from 'vitest';
import { getOrdersByIds } from '../../src/services/supabase/orders';

const mockDatabase: Record<string, any[]> = {
    orders: [
        {
            id: '11111111-1111-1111-1111-111111111111',
            case_id: 'C01',
            doctor_id: 'd1',
            patient_name: 'Patient A',
            discount: 0,
            total_price: 100,
            shade: 'A1',
            status: 'New Case',
            delivery_date: '2026-07-10',
            cost: 80,
            priority: 'Normal',
            created_at: '2026-07-01T12:00:00Z',
            is_deleted: false,
        },
        {
            id: '22222222-2222-2222-2222-222222222222',
            case_id: 'C02',
            doctor_id: 'd2',
            patient_name: 'Patient B',
            discount: 10,
            total_price: 200,
            shade: 'A2',
            status: 'Completed',
            delivery_date: '2026-07-11',
            cost: 150,
            priority: 'Urgent',
            created_at: '2026-07-02T12:00:00Z',
            is_deleted: true,
        }
    ],
};
const roleApi=vi.hoisted(()=>({role:'admin',error:null as null|{message:string},calls:[] as string[]}));

vi.mock('../../src/lib/supabase', () => {
    let currentTable = '';
    const inFilters: Record<string, any[]> = {};

    const chain = {
        select: () => chain,
        in: (field: string, values: any[]) => {
            inFilters[field] = values;
            return chain;
        },
        then: (onfulfilled: any) => {
            const table = currentTable;
            const matches = mockDatabase[table]?.filter(item => {
                for (const [key, vals] of Object.entries(inFilters)) {
                    if (!vals.includes(item[key])) return false;
                }
                return true;
            }) || [];
            return Promise.resolve({ data: matches, error: null }).then(onfulfilled);
        },
    };

    const mockSupabase = {
        rpc: async(name:string)=>{
            roleApi.calls.push(name);
            if(name==='get_my_role')return {data:roleApi.role,error:roleApi.error};
            if(name==='get_designer_workspace')return {data:[{id:'11111111-1111-1111-1111-111111111111',case_id:'C01',patient_name:'Assigned technical case',order_items:[]}],error:null};
            throw new Error(`Unexpected RPC: ${name}`);
        },
        from: (table: string) => {
            currentTable = table;
            for (const key of Object.keys(inFilters)) delete inFilters[key];
            return chain;
        },
    };

    return {
        supabase: mockSupabase,
    };
});

describe('getOrdersByIds', () => {
    it('should return empty array if empty ids list passed', async () => {
        const result = await getOrdersByIds([]);
        expect(result).toEqual([]);
    });

    it('should return empty array if invalid ids list passed', async () => {
        const result = await getOrdersByIds(['invalid-uuid', '']);
        expect(result).toEqual([]);
    });

    it('should fetch matching orders, deduplicate ids, and handle missing ones gracefully', async () => {
        const result = await getOrdersByIds([
            '11111111-1111-1111-1111-111111111111',
            '11111111-1111-1111-1111-111111111111', // duplicate
            '22222222-2222-2222-2222-222222222222',
            '33333333-3333-3333-3333-333333333333', // non-existent
        ]);

        expect(result.length).toBe(2);
        
        const order1 = result.find(o => o.id === '11111111-1111-1111-1111-111111111111');
        expect(order1).toBeDefined();
        expect(order1?.patientName).toBe('Patient A');
        expect(order1?.isDeleted).toBe(false);

        const order2 = result.find(o => o.id === '22222222-2222-2222-2222-222222222222');
        expect(order2).toBeDefined();
        expect(order2?.patientName).toBe('Patient B');
        expect(order2?.isDeleted).toBe(true);
    });
    it('uses the scoped server projection for designers',async()=>{
        roleApi.role='designer';roleApi.calls=[];
        try{
            const result=await getOrdersByIds(['11111111-1111-1111-1111-111111111111']);
            expect(result).toHaveLength(1);
            expect(result[0].patientName).toBe('Assigned technical case');
            expect(result[0].supplierId).toBeUndefined();
            expect(result[0].totalPrice).toBeUndefined();
            expect(roleApi.calls).toEqual(['get_my_role','get_designer_workspace']);
        }finally{roleApi.role='admin';}
    });
    it('does not fall back to raw orders when role lookup fails',async()=>{
        roleApi.error={message:'Role lookup unavailable'};
        try{await expect(getOrdersByIds(['11111111-1111-1111-1111-111111111111'])).rejects.toThrow();}
        finally{roleApi.error=null;}
    });
});

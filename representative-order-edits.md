# Plan: Representative Order Edits & Admin Approval

## Goal
Implement a system where representatives can edit specific fields (Patient Name, Delivery Date, Supplier/Designer, STL, Photos, Notes, Services/Items) of an order. For undelivered orders, edits apply directly and log as history. For delivered orders, edits are stored as pending proposals requiring admin approval. A review card in the Admin dashboard allows viewing direct edits and approving/rejecting pending proposals.

## Tasks
- [ ] Task 1: Create SQL Migration for DB changes → Verify: Run migration, verify trigger and RPC compilation in DB
- [ ] Task 2: Update `workflowPermissions.ts` to allow new fields and update state guards → Verify: Compile code and run typecheck
- [ ] Task 3: Update `orderWorkflow.ts` and `db.ts` to support the new fields and add admin review client wrappers → Verify: Compile code and run typecheck
- [ ] Task 4: Enhance `RepEditModal.tsx` UI to include Notes (`instructions`) and Services (`items` with `TeethTagsInput` and price recalculation) → Verify: Build and open the modal, see new inputs
- [ ] Task 5: Update `DashboardNew.tsx` to display direct edits feed and pending approval cards, with an action modal for Admin approval/rejection → Verify: Check the Admin view for new dashboard cards
- [ ] Task 6: Final Verification → Verify: Run `npm run typecheck && npm run lint && npm run build`

## Done When
- Representatives can edit patient_name, delivery_date, supplier_id, designer_id, stl_url, images_url, instructions, items.
- Edits to undelivered cases apply directly and show in history.
- Edits to delivered cases create a pending proposal.
- Admin dashboard has a card to review direct edits (undelivered) and approve/reject pending proposals (delivered) with notes.
- The project compiles and runs cleanly.

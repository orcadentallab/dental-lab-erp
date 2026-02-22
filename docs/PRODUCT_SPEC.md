# Dental Lab ERP - Product Specification

## Overview
Dental Lab ERP is a web-based management system for dental laboratories. It manages orders, doctors, suppliers, finances, and workflows.

## User Roles
- **Admin**: Full access to all features
- **Representative**: Create orders, manage doctors
- **Designer**: Handle design phase of orders
- **Lab**: Manage production workflow
- **Accountant**: Financial management
- **Doctor**: View their orders and submit requests

## Core Features

### Authentication
- Login page at `/login`
- Role-based access control
- Session management via Supabase Auth

### Dashboard (`/dashboard`)
- Overview statistics (active orders, today's orders, ready orders)
- Alert cards for: rejected orders, overdue orders, pending approvals
- Quick actions: new order, new doctor
- Lab workload display

### Orders Management (`/orders`)
- List all orders with pagination (50 per page)
- Filter by: status, doctor, supplier, designer, date range
- Search by case ID or patient name
- Create new order (admin, representative only)
- Edit order details
- Add comments to orders
- Change order status
- Tech actions: Accept/Reject (admin, designer, lab only)
- Export to Excel, Print

### Order Statuses
- Pending Review, New Case, Under Design, Waiting Dr Approval
- Under Production, Try In, Ready, Completed, Delivered
- Rejected, Returned for Adjustments, Cancelled

### Doctors Management (`/doctors`)
- List all doctors
- Add new doctor
- Edit doctor details
- Doctor code assignment

### Suppliers/Labs (`/suppliers`)
- List suppliers
- Custom pricing per supplier
- Milling prices

### Finance (`/finance`)
- Income/Expense tracking
- Transaction management

### Accounts (`/accounts`)
- Doctor account statements
- Supplier account statements
- Total account overview

### Reports (`/analytics`)
- Order analytics
- Revenue reports
- AI-powered insights

## Technical Stack
- React 18 + TypeScript
- Vite dev server (port 5173)
- Supabase (Database + Auth)
- RTL Arabic interface

## Test Scenarios

### Login Flow
1. Navigate to `/login`
2. Enter valid credentials
3. Verify redirect to dashboard
4. Verify user name appears in header

### Orders Page
1. Navigate to `/orders`
2. Verify orders list loads
3. Test search functionality
4. Test status filter
5. Test pagination
6. Add a comment to an order
7. Verify comment persists after refresh

### Dashboard
1. Verify statistics cards display
2. Verify alert cards show correct counts
3. Test "New Order" button (admin/representative)
4. Verify lab workload section

### Role-Based Access
1. Admin can see Accept/Reject buttons
2. Designer can see Accept/Reject buttons
3. Lab can see Accept/Reject buttons
4. Representative CANNOT see Accept/Reject buttons
5. Accountant CANNOT see Accept/Reject buttons

# Dental Lab ERP - Project Summary

## Overview
This project is a comprehensive **Enterprise Resource Planning (ERP)** system designed specifically for dental laboratories. It aims to streamline daily operations, including order management, doctor/client tracking, financial management, staff administration, and quality control.

## Technology Stack
The application is built using a modern, robust, and high-performance tech stack:

*   **Frontend Framework:** React 19 with Vite (providing a fast development experience and optimized build).
*   **Language:** TypeScript (ensuring type safety and code maintainability).
*   **Styling:** Tailwind CSS (for building modern, responsive, and consistent user interfaces).
*   **Backend & Database:** Supabase (Backend-as-a-Service) used for authentication, database, and real-time capabilities.
*   **Key Libraries:**
    *   `react-router-dom`: Client-side routing.
    *   `lucide-react`: Modern icon set.
    *   `date-fns`: Date manipulation and formatting.
    *   `xlsx`: Excel file import/export functionality.
    *   `zod`: Schema declaration and data validation.

## Key Modules & Features
Based on the project structure, the system includes the following core modules:

### 1. Dashboard & Analytics
*   **Main Dashboard:** (`Dashboard.tsx`, `DashboardNew.tsx`) Provides a high-level overview of lab performance, key metrics, and daily activities.
*   **Designer Dashboard:** (`DesignerDashboard.tsx`) A specialized view tailored for CAD/CAM designers.
*   **Analytics:** (`Analytics.tsx`) detailed reports and data visualization.

### 2. Operations Management
*   **Order Management:** (`Orders.tsx`) Central hub for tracking cases from entry to delivery, managing status workflows.
*   **Quality Control:** (`Quality.tsx`) Tracking quality issues and ensuring standards.

### 3. CRM & Stakeholders
*   **Doctors:** (`Doctors.tsx`) Management of client/doctor profiles and preferences.
*   **Accounts:** (`Accounts.tsx`) Managing financial accounts related to clients.
*   **Suppliers:** (`Suppliers.tsx`) Managing material suppliers and orders.

### 4. Finance & HR
*   **Finance:** (`Finance.tsx`) Comprehensive financial tracking including expenses, income, and profitability.
*   **Staff Management:** (`Staff.tsx`) Employee records, roles, and potentially performance tracking.

### 5. Administration
*   **User Management:** (`Users.tsx`) System user administration and role-based access control.
*   **Settings:** (`Settings.tsx`) System-wide configurations.
*   **Authentication:** (`Login.tsx`) Secure access to the system.

## Project Structure Highlights
*   `/src/pages`: Contains the main view components for each route/feature.
*   `/src/components`: Reusable UI components.
*   `/src/services`: API integration layers (Supabase).
*   `/src/context`: Global state management.
*   `/src/lib` & `/src/utils`: Helper functions and configurations.

## Deployment
The project is configured for easy deployment on modern platforms like Vercel or Netlify, with standard build scripts and configuration files included.

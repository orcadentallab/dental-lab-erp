import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/DashboardNew';
import Orders from './pages/Orders';

import ProtectedRoute from './components/ProtectedRoute';
import DashboardLayout from './layouts/DashboardLayout';
import { lazy, Suspense } from 'react';

const MarketingPage = lazy(() => import('./marketing/MarketingPage'));
const MarketingAnalytics = lazy(() => import('./pages/MarketingAnalytics'));
const Doctors = lazy(() => import('./pages/Doctors'));
const Finance = lazy(() => import('./pages/Finance'));
const Analytics = lazy(() => import('./pages/Analytics'));
const DesignerStats = lazy(() => import('./pages/DesignerStats'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Accounts = lazy(() => import('./pages/Accounts'));
const UsersPage = lazy(() => import('./pages/Users'));
const Settings = lazy(() => import('./pages/Settings'));
const ServicesPage = lazy(() => import('./pages/Services'));
const QualityDashboard = lazy(() => import('./pages/Quality'));
const AIAnalytics = lazy(() => import('./pages/AIAnalytics'));
const CaseRegistration = lazy(() => import('./pages/CaseRegistration'));
const Employees = lazy(() => import('./pages/Employees'));
const EmployeeDetail = lazy(() => import('./pages/EmployeeDetail'));
const IssuesReport = lazy(() => import('./pages/IssuesReport'));
const NewOrderRequest = lazy(() => import('./pages/doctor/NewOrderRequest'));
const DoctorOrders = lazy(() => import('./pages/doctor/DoctorOrders'));
const DoctorFinance = lazy(() => import('./pages/doctor/DoctorFinance'));
const BalanceSnapshot = lazy(() => import('./pages/BalanceSnapshot'));
const Statements = lazy(() => import('./pages/Statements'));
const AgingReport = lazy(() => import('./pages/AgingReport'));
const DoctorRetention = lazy(() => import('./pages/DoctorRetention'));
import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider } from './context/LanguageContext';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import TitleUpdater from './components/TitleUpdater';

function App() {
  return (
    <LanguageProvider>
      <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
        <BrowserRouter>
          <TitleUpdater />
          <ErrorBoundary>
            <AuthProvider>
              <ToastProvider>
                <Suspense fallback={<div className="min-h-screen bg-brand-offwhite" />}>
                <Routes>
                  <Route path="/login" element={<Login />} />


                  <Route path="/" element={<Suspense fallback={<div className="min-h-screen bg-brand-offwhite" />}><MarketingPage /></Suspense>} />

                  <Route element={<ProtectedRoute />}>
                    <Route element={<ProtectedRoute allowedRoles={['admin', 'lab', 'representative', 'accountant', 'designer']} />}>
                      <Route element={<DashboardLayout />}>
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/orders" element={<Orders />} />
                        <Route element={<ProtectedRoute allowedRoles={['admin', 'representative']} />}>
                          <Route path="/doctors" element={<Doctors />} />
                          <Route path="/doctors/retention" element={<DoctorRetention />} />
                        </Route>
                        <Route element={<ProtectedRoute allowedRoles={['admin', 'representative', 'lab']} />}>
                          <Route path="/quality" element={<QualityDashboard />} />
                        </Route>
                      </Route>
                    </Route>
                  </Route>

                  {/* Accounts: Shared + Designer */}
                  <Route element={<ProtectedRoute allowedRoles={['admin', 'accountant', 'lab', 'representative', 'designer']} />}>
                    <Route element={<DashboardLayout />}>
                      <Route path="/accounts" element={<Accounts />} />
                    </Route>
                  </Route>

                  {/* Settings: No Designer */}
                  <Route element={<ProtectedRoute allowedRoles={['admin', 'accountant', 'lab', 'representative']} />}>
                    <Route element={<DashboardLayout />}>
                      <Route path="/settings" element={<Settings />} />
                    </Route>
                  </Route>

                  {/* Staff Affairs: Admin, Accountant, Representative */}
                  <Route element={<ProtectedRoute allowedRoles={['admin', 'accountant', 'representative']} />}>
                    <Route element={<DashboardLayout />}>
                      <Route path="/employees" element={<Employees />} />
                      <Route path="/employees/:id" element={<EmployeeDetail />} />
                      <Route path="/staff" element={<Navigate to="/employees" replace />} />
                    </Route>
                  </Route>

                  {/* Admin & Accountant Only */}
                  <Route element={<ProtectedRoute allowedRoles={['admin', 'accountant']} />}>
                    <Route element={<DashboardLayout />}>
                      <Route path="/finance" element={<Finance />} />
                      <Route path="/suppliers" element={<Suppliers />} />
                      <Route path="/case-registration" element={<CaseRegistration />} />
                      <Route path="/balance-snapshot" element={<BalanceSnapshot />} />
                      <Route path="/statements" element={<Statements />} />
                      <Route path="/aging-report" element={<AgingReport />} />
                    </Route>
                  </Route>

                  {/* Admin Only Routes */}
                  <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
                    <Route element={<DashboardLayout />}>
                      <Route path="/analytics" element={<Analytics />} />
                      <Route path="/ai-analytics" element={<AIAnalytics />} />
                      <Route path="/users" element={<UsersPage />} />
                      <Route path="/services" element={<ServicesPage />} />
                      <Route path="/issues-report" element={<IssuesReport />} />
                      <Route path="/marketing-analytics" element={<Suspense fallback={<div />}><MarketingAnalytics /></Suspense>} />
                      <Route path="/designer-stats" element={<DesignerStats />} />


                    </Route>
                  </Route>

                  {/* Doctor Portal Routes */}
                  <Route element={<ProtectedRoute allowedRoles={['doctor']} />}>
                    <Route element={<DashboardLayout />}>
                      <Route path="/doctor/new-request" element={<NewOrderRequest />} />
                      <Route path="/doctor/my-orders" element={<DoctorOrders />} />
                      <Route path="/doctor/account" element={<DoctorFinance />} />
                    </Route>
                  </Route>

                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
                </Suspense>
              </ToastProvider>
            </AuthProvider>
          </ErrorBoundary>
        </BrowserRouter>
      </ThemeProvider>
    </LanguageProvider>
  );
}

export default App;

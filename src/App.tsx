import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/DashboardNew';
import Orders from './pages/Orders';
import Doctors from './pages/Doctors';
import Finance from './pages/Finance';
import Analytics from './pages/Analytics';
import Suppliers from './pages/Suppliers';
import Accounts from './pages/Accounts';
import UsersPage from './pages/Users';
import Settings from './pages/Settings';
import QualityDashboard from './pages/Quality';
import AIAnalytics from './pages/AIAnalytics';
import Staff from './pages/Staff'; // New Import
import NewOrderRequest from './pages/doctor/NewOrderRequest';
import DoctorOrders from './pages/doctor/DoctorOrders';
import DoctorFinance from './pages/doctor/DoctorFinance';
import ProtectedRoute from './components/ProtectedRoute';
import DashboardLayout from './layouts/DashboardLayout';

import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider } from './context/LanguageContext';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/ErrorBoundary';

function App() {
  return (
    <LanguageProvider>
      <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
        <BrowserRouter>
          <ErrorBoundary>
            <AuthProvider>
              <ToastProvider>
                <Routes>
                  <Route path="/login" element={<Login />} />

                  <Route element={<ProtectedRoute />}>
                    <Route element={<ProtectedRoute allowedRoles={['admin', 'lab', 'representative', 'accountant', 'designer']} />}>
                      <Route element={<DashboardLayout />}>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/orders" element={<Orders />} />
                        <Route element={<ProtectedRoute allowedRoles={['admin', 'representative']} />}>
                          <Route path="/doctors" element={<Doctors />} />
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
                      <Route path="/staff" element={<Staff />} />
                    </Route>
                  </Route>

                  {/* Admin & Accountant Only */}
                  <Route element={<ProtectedRoute allowedRoles={['admin', 'accountant']} />}>
                    <Route element={<DashboardLayout />}>
                      <Route path="/finance" element={<Finance />} />
                      <Route path="/suppliers" element={<Suppliers />} />
                    </Route>
                  </Route>

                  {/* Admin Only Routes */}
                  <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
                    <Route element={<DashboardLayout />}>
                      <Route path="/analytics" element={<Analytics />} />
                      <Route path="/ai-analytics" element={<AIAnalytics />} />
                      <Route path="/users" element={<UsersPage />} />

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
              </ToastProvider>
            </AuthProvider>
          </ErrorBoundary>
        </BrowserRouter>
      </ThemeProvider>
    </LanguageProvider>
  );
}

export default App;

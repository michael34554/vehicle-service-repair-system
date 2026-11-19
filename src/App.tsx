import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import type { NavItemKey } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { ToastNotification, ToastMessage } from './components/ToastNotification';
import { CustomerManagementView } from './components/views/CustomerManagementView';
import { VehicleManagementView } from './components/views/VehicleManagementView';
import { ServiceRepairManagementView } from './components/views/ServiceRepairManagementView';
import { InventoryManagementView } from './components/views/InventoryManagementView';
import { WorkshopFloorLiveView } from './components/views/WorkshopFloorLiveView';
import { AuthPage, AuthMode } from './components/AuthPage';
import { LandingPage } from './components/LandingPage';
import { apiFetch, initializeCsrfToken } from './api';

import { CustomerAuthPage } from './components/CustomerAuthPage';
import { CustomerDashboardView } from './components/views/CustomerDashboardView';
import { AiDiagnosisView } from './components/views/AiDiagnosisView';
import { SmartWorkshopView } from './components/views/SmartWorkshopView';

type AppView = 'landing' | 'auth' | 'dashboard' | 'customer-auth' | 'customer-dashboard';
export default function App() {
  const [currentView, setCurrentView] = useState<AppView>('landing');
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [activeTab, setActiveTab] = useState<NavItemKey>('dashboard');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [unreadAlertsCount, setUnreadAlertsCount] = useState(0);
  const [selectedRepairId, setSelectedRepairId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ name: string; role: string } | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Sync dark mode class on document element
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    let isMounted = true;
    const onSessionExpired = () => {
      setAuthMode('signin');
      setCurrentView((view) => view === 'dashboard' ? 'auth' : view);
    };
    window.addEventListener('nextgen:session-expired', onSessionExpired);
    initializeCsrfToken()
      .then(() => apiFetch('/api/auth/me'))
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 401) {
            const customerResponse = await fetch('/api/customer/auth/me', { credentials: 'same-origin' });
            if (customerResponse.ok && isMounted) setCurrentView('customer-dashboard');
            return;
          }
          throw new Error(`Session check failed with status ${response.status}.`);
        }
        const session = await response.json() as { user: { id: string } | null };
        if (isMounted && session.user) setCurrentView('dashboard');
      })
      .catch((error: unknown) => {
        console.error('Unable to initialize the NEXTGEN session:', error);
      })
      .finally(() => {
        if (isMounted) setIsCheckingSession(false);
      });
    return () => {
      isMounted = false;
      window.removeEventListener('nextgen:session-expired', onSessionExpired);
    };
  }, []);

  useEffect(() => {
    if (currentView !== 'dashboard') {
      setCurrentUser(null);
      return;
    }
    let active = true;
    apiFetch('/api/auth/me')
      .then(async (response) => {
        const session = await response.json() as { user?: { name?: string; role?: string } | null };
        if (!response.ok) throw new Error(`Account details failed with status ${response.status}.`);
        if (active && session.user) {
          setCurrentUser({
            name: session.user.name ?? 'Signed-in user',
            role: session.user.role ?? '',
          });
        }
      })
      .catch((error: unknown) => {
        console.error('Unable to load the signed-in account details:', error);
      });
    return () => {
      active = false;
    };
  }, [currentView]);

  const addToast = (type: 'success' | 'warning' | 'info', title: string, detail?: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    setToasts((prev) => [...prev, { id, type, title, detail }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const handleDismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleAlertsCountChange = useCallback((count: number) => {
    setUnreadAlertsCount(count);
  }, []);

  const handleViewRepair = (repairId: string) => {
    setSelectedRepairId(repairId);
    setActiveTab('job_cards');
  };

  const handleSignOut = async () => {
    try {
      const response = await apiFetch('/api/auth/logout', { method: 'POST' }, false);
      if (!response.ok) throw new Error(`Sign out failed with status ${response.status}.`);
      setActiveTab('dashboard');
      setCurrentView('landing');
    } catch (error) {
      addToast('warning', 'Sign out failed', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  if (isCheckingSession) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f7fb] text-[#1c5fa6]">
        <p className="rounded-full border border-[#dce5ef] bg-white px-5 py-3 text-sm font-semibold shadow-sm">
          Loading NEXTGEN…
        </p>
      </main>
    );
  }


  if (currentView === 'landing') {
    return (
      <LandingPage
        onGetStarted={() => {
          setAuthMode('signup');
          setCurrentView('auth');
        }}
        onSignIn={() => {
          setAuthMode('signin');
          setCurrentView('auth');
        }}
        onCustomerPortal={() => setCurrentView('customer-auth')}
      />
    );
  }


  if (currentView === 'auth') {
    return (
      <AuthPage
        mode={authMode}
        onModeChange={setAuthMode}
        onBack={() => setCurrentView('landing')}
        onAuthenticated={() => setCurrentView('dashboard')}
      />
    );
  }

  if (currentView === 'customer-auth') {
    return (
      <CustomerAuthPage
        onAuthenticated={() => setCurrentView('customer-dashboard')}
        onBack={() => setCurrentView('landing')}
      />
    );
  }

  if (currentView === 'customer-dashboard') {
    return (
      <>
        <button
          className="absolute top-4 right-4 bg-blue-600 text-white px-4 py-2 rounded"
          onClick={async () => {
            const response = await apiFetch('/api/customer/auth/logout', { method: 'POST' }, false);
            if (response.ok) setCurrentView('landing');
          }}
        >Logout</button>
        <CustomerDashboardView />
      </>
    );
  }

  return (
    <div className="flex h-screen w-full bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden font-sans">
      {/* 1. Left Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        user={currentUser}
        onSelectTab={setActiveTab}
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
        onSignOut={handleSignOut}
      />

      {/* 2. Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Top Header Bar */}
        <TopHeader
          activeTab={activeTab}
          isDarkMode={isDarkMode}
          onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
          onOpenRepairManagement={() => setActiveTab('job_cards')}
          onOpenVehicleManagement={() => setActiveTab('vehicles')}
          unreadAlertsCount={unreadAlertsCount}
          onOpenWorkshopFloor={() => setActiveTab('dashboard')}
          onSignOut={handleSignOut}
        />

        {/* Scrollable Viewport */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'dashboard' ? (
            <WorkshopFloorLiveView
              onViewRepair={handleViewRepair}
              onAlertsCountChange={handleAlertsCountChange}
            />
          ) : activeTab === 'vehicles' ? (
            <VehicleManagementView />
          ) : activeTab === 'customers' ? (
            <CustomerManagementView />
          ) : activeTab === 'inventory' ? (
            <InventoryManagementView />
          ) : activeTab === 'diagnosis' ? (
            <AiDiagnosisView />
          ) : activeTab === 'smart_workshop' ? (
            <SmartWorkshopView onViewRepair={handleViewRepair} />
          ) : (
            <ServiceRepairManagementView
              initialJobId={selectedRepairId}
              onInitialJobHandled={() => setSelectedRepairId(null)}
            />
          )}
        </main>
      </div>

      {/* Action toast notifications */}
      <ToastNotification toasts={toasts} onDismiss={handleDismissToast} />
    </div>
  );
}

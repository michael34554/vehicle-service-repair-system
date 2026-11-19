import React, { useState } from 'react';
import {
  Bell,
  Moon,
  Sun,
  Plus,
  CarFront,
  LogOut,
} from 'lucide-react';
import type { NavItemKey } from './Sidebar';

interface TopHeaderProps {
  activeTab: NavItemKey;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenRepairManagement: () => void;
  onOpenVehicleManagement: () => void;
  unreadAlertsCount: number;
  onOpenWorkshopFloor: () => void;
  onSignOut: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  activeTab,
  isDarkMode,
  onToggleDarkMode,
  onOpenRepairManagement,
  onOpenVehicleManagement,
  unreadAlertsCount,
  onOpenWorkshopFloor,
  onSignOut,
}) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const pageTitle: Record<NavItemKey, string> = {
    dashboard: 'Workshop Floor Live',
    customers: 'Customer Management',
    vehicles: 'Vehicle Management',
    inventory: 'Spare Parts & Inventory',
    job_cards: 'Service & Repair Management',
    diagnosis: 'AI Fault Diagnosis',
    smart_workshop: 'AI Smart Workshop',
  };

  return (
    <header className="h-20 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 flex items-center justify-between gap-4 sticky top-0 z-20">
      <div className="flex flex-1 items-center">
        <div className="hidden lg:flex flex-col">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-medium">
            <span>NEXTGEN</span>
            <span aria-hidden="true">/</span>
            <span className="text-slate-800 dark:text-slate-200 font-semibold">{pageTitle[activeTab]}</span>
          </div>
          <span className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
            {pageTitle[activeTab]}
          </span>
        </div>
      </div>

      {/* Right Zone: Actions and account controls */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Notifications Popover */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 relative transition-colors"
            title="Workshop alerts"
            aria-label="View notifications"
          >
            <Bell className="w-5 h-5" />
            {unreadAlertsCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-amber-500 rounded-full" />
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 p-2 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="px-3 py-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {unreadAlertsCount > 0
                    ? `${unreadAlertsCount} current alerts from active repair records.`
                    : 'Workshop alerts are derived from current repair records.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowNotifications(false);
                    onOpenWorkshopFloor();
                  }}
                  className="mt-3 w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  View Workshop Floor Live
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Dark Mode Switcher */}
        <button
          onClick={onToggleDarkMode}
          className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label="Toggle color theme"
        >
          {isDarkMode ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5" />}
        </button>

        {/* Vehicle module shortcut */}
        <button
          onClick={onOpenVehicleManagement}
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors border border-slate-200 dark:border-slate-700"
        >
          <CarFront className="w-3.5 h-3.5" />
          <span>Manage Vehicles</span>
        </button>

        {/* Repair module shortcut */}
        <button
          onClick={onOpenRepairManagement}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-sm transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="whitespace-nowrap">New Repair Job</span>
        </button>
        <button
          onClick={onSignOut}
          className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Return to landing page"
          aria-label="Sign out"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};

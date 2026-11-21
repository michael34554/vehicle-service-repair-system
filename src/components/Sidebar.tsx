import React from 'react';
import { canAccessNav, type NavItemKey } from '../../shared/permissions';
export type { NavItemKey } from '../../shared/permissions';
import {
  LayoutDashboard,
  Users,
  Car,
  FileSpreadsheet,
  Boxes,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Stethoscope,
  Box,
  UserCog,
  Wrench,
} from 'lucide-react';

interface SidebarProps {
  activeTab: NavItemKey;
  user: { name: string; role: string } | null;
  onSelectTab: (tab: NavItemKey) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSignOut: () => void;
}

interface NavItemDef {
  key: NavItemKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItemDef[] = [
  { key: 'customers', label: 'Customer Management', icon: Users },
  { key: 'vehicles', label: 'Vehicle Management', icon: Car },
  { key: 'mechanics', label: 'Mechanic Management', icon: UserCog },
  { key: 'job_cards', label: 'Service and Repair Management', icon: FileSpreadsheet },
  { key: 'inventory', label: 'Spare Parts and Inventory Management', icon: Boxes },
  { key: 'diagnosis', label: 'AI Fault Diagnosis', icon: Stethoscope },
  { key: 'smart_workshop', label: 'AI Smart Workshop', icon: Box },
  { key: 'dashboard', label: 'Workshop Floor Live', icon: LayoutDashboard },
];

const PERSONAL_ITEMS: NavItemDef[] = [
  { key: 'mechanic_workspace', label: 'Mechanic Workspace', icon: Wrench },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  user,
  onSelectTab,
  isCollapsed,
  onToggleCollapse,
  onSignOut,
}) => {
  const displayName = user?.name ?? 'Loading account…';
  const roleLabel: Record<string, string> = {
    owner: 'Administrator',
    manager: 'Workshop Manager',
    advisor: 'Workshop Staff',
    technician: 'Mechanic',
  };
  const visibleItems = NAV_ITEMS.filter((item) => canAccessNav(user?.role, item.key));
  const visiblePersonalItems = PERSONAL_ITEMS.filter((item) => canAccessNav(user?.role, item.key));
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toLocaleUpperCase())
    .join('') || 'U';

  const renderNavItem = (item: NavItemDef) => {
    const Icon = item.icon;
    const isActive = activeTab === item.key;

    return (
      <button
        key={item.key}
        onClick={() => onSelectTab(item.key)}
        title={isCollapsed ? item.label : undefined}
        className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors group relative ${
          isActive
            ? 'bg-blue-600 text-white shadow-sm font-semibold'
            : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
        }`}
      >
        <Icon
          className={`w-4 h-4 shrink-0 transition-transform duration-200 group-hover:scale-105 ${
            isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
          }`}
        />
        {!isCollapsed && (
          <span className="truncate flex-1 text-left whitespace-nowrap">
            {item.label}
          </span>
        )}
        {isCollapsed && isActive && (
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-blue-400 rounded-l" />
        )}
      </button>
    );
  };

  return (
    <aside
      className={`relative flex flex-col shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-900 text-slate-200 transition-all duration-300 z-30 select-none ${
        isCollapsed ? 'w-20' : 'w-72'
      }`}
    >
      {/* Brand Header */}
      <div className="h-20 flex items-center px-5 border-b border-slate-800/80 justify-between">
        {!isCollapsed ? (
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/30 shrink-0">
              <Gauge className="w-5 h-5" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="truncate text-[10px] font-semibold tracking-[0.12em] text-blue-300 uppercase">
                VEHICLE SERVICE & REPAIR
              </span>
              <h1 className="text-lg font-extrabold text-white tracking-[0.08em] leading-tight truncate">
                NEXTGEN
              </h1>
            </div>
          </div>
        ) : (
          <div className="w-10 h-10 mx-auto rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/30">
            <Gauge className="w-5 h-5" />
          </div>
        )}

        <button
          onClick={onToggleCollapse}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ${
            isCollapsed ? 'hidden' : 'block'
          }`}
          aria-label="Toggle navigation"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {visibleItems.map(renderNavItem)}
        {visiblePersonalItems.length > 0 && (
          <div className="mt-3 border-t border-slate-800 pt-3">
            {!isCollapsed && (
              <p className="px-3.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                My workspace
              </p>
            )}
            {visiblePersonalItems.map(renderNavItem)}
          </div>
        )}
      </div>

      {/* Collapse button when collapsed */}
      {isCollapsed && (
        <div className="p-3 flex justify-center border-t border-slate-800">
          <button
            onClick={onToggleCollapse}
            title="Expand sidebar"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* User profile & shift footer */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-950/40">
        {!isCollapsed ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-9 h-9 rounded-full bg-slate-700 border border-slate-600 text-xs font-bold text-slate-200 flex items-center justify-center shrink-0">
                {initials}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-white truncate">
                  {displayName}
                </span>
                <span className="text-[11px] text-slate-400 truncate">
                  {user ? roleLabel[user.role] ?? user.role : 'Loading'}
                </span>
              </div>
            </div>
            <button
              title="Sign out"
              aria-label="Sign out"
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-md transition-colors"
              onClick={onSignOut}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div
              title={`${displayName} (${user ? roleLabel[user.role] ?? user.role : 'Loading'})`}
              className="w-9 h-9 rounded-full bg-slate-700 border border-slate-600 text-xs font-bold text-slate-200 flex items-center justify-center cursor-pointer"
            >
              {initials}
            </div>
            <button
              onClick={onSignOut}
              title="Sign out"
              aria-label="Sign out"
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-rose-400"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};

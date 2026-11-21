export type WorkshopRole = 'owner' | 'manager' | 'advisor' | 'technician';

export type NavItemKey =
  | 'dashboard'
  | 'customers'
  | 'vehicles'
  | 'inventory'
  | 'job_cards'
  | 'diagnosis'
  | 'smart_workshop'
  | 'mechanics'
  | 'mechanic_workspace';

const STAFF_ROLES: readonly WorkshopRole[] = ['owner', 'manager', 'advisor'];
const ALL_WORKSHOP_ROLES: readonly WorkshopRole[] = [...STAFF_ROLES, 'technician'];

// Keep this map aligned with server route guards:
// requireCustomerStaff / requireVehicleStaff / requireRepairStaff / requireInventoryManager
// and the technician-only mechanic workspace.
const NAV_PERMISSIONS: Record<NavItemKey, readonly WorkshopRole[]> = {
  dashboard: ALL_WORKSHOP_ROLES,
  customers: STAFF_ROLES,
  vehicles: STAFF_ROLES,
  inventory: ALL_WORKSHOP_ROLES,
  job_cards: ALL_WORKSHOP_ROLES,
  diagnosis: ALL_WORKSHOP_ROLES,
  smart_workshop: ALL_WORKSHOP_ROLES,
  mechanics: STAFF_ROLES,
  mechanic_workspace: ['technician'],
};

export function isStaffRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager' || role === 'advisor';
}

export function canAccessNav(role: string | null | undefined, key: NavItemKey): boolean {
  if (!role) return false;
  const allowed = NAV_PERMISSIONS[key];
  return allowed ? allowed.includes(role as WorkshopRole) : false;
}

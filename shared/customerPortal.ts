/**
 * Customer portal status vocabulary.
 *
 * These values are the NEXTGEN repair statuses already stored in `jobs.repair_status`.
 * No new repair status is introduced for the portal; the portal only presents the
 * existing workflow in customer-friendly language.
 */
export const REPAIR_TRACKING_STAGES = [
  { status: 'Received', label: 'Vehicle received', detail: 'Your vehicle has been booked into the workshop.' },
  { status: 'Awaiting Inspection', label: 'Initial inspection', detail: 'The workshop is preparing the initial inspection.' },
  { status: 'Under Inspection', label: 'Inspection in progress', detail: 'A technician is inspecting the reported problem.' },
  { status: 'Awaiting Customer Approval', label: 'Awaiting your approval', detail: 'The workshop has findings that need your approval before work continues.' },
  { status: 'Approved', label: 'Repair approved', detail: 'Approved work is queued for the repair bay.' },
  { status: 'In Progress', label: 'Repair in progress', detail: 'The approved repair work is being carried out.' },
  { status: 'Awaiting Spare Parts', label: 'Awaiting spare parts', detail: 'The workshop is waiting for recorded parts to arrive.' },
  { status: 'Repair Completed', label: 'Repair completed', detail: 'The repair work has been completed and is awaiting final checks.' },
  { status: 'Ready for Collection', label: 'Ready for collection', detail: 'Your vehicle is ready to be collected.' },
  { status: 'Collected', label: 'Collected', detail: 'Your vehicle has been collected.' },
] as const;

export type RepairTrackingStatus = typeof REPAIR_TRACKING_STAGES[number]['status'];

export interface CustomerNotificationTemplate {
  type: string;
  title: string;
  message: string;
}

const NOTIFICATION_TEMPLATES: Readonly<Record<string, CustomerNotificationTemplate>> = {
  Received: {
    type: 'job_received',
    title: 'Your vehicle has been received',
    message: 'The workshop has booked in your vehicle and will begin the initial inspection.',
  },
  'Awaiting Inspection': {
    type: 'inspection_scheduled',
    title: 'Initial inspection scheduled',
    message: 'Your vehicle is queued for its initial inspection.',
  },
  'Under Inspection': {
    type: 'inspection_started',
    title: 'Inspection in progress',
    message: 'A technician is inspecting the problem you reported.',
  },
  'Awaiting Customer Approval': {
    type: 'approval_required',
    title: 'Your approval is needed',
    message: 'The workshop has findings that require your approval before further work continues.',
  },
  Approved: {
    type: 'repair_approved',
    title: 'Repair approved',
    message: 'The approved work has been added to the repair queue.',
  },
  'In Progress': {
    type: 'repair_in_progress',
    title: 'Your repair is in progress',
    message: 'The approved repair work is now being carried out.',
  },
  'Awaiting Spare Parts': {
    type: 'awaiting_parts',
    title: 'Waiting for spare parts',
    message: 'The workshop is waiting for recorded spare parts before work can continue.',
  },
  'Repair Completed': {
    type: 'repair_completed',
    title: 'Repair completed',
    message: 'The recorded repair work is complete and final checks are underway.',
  },
  'Ready for Collection': {
    type: 'ready_for_collection',
    title: 'Your vehicle is ready for collection',
    message: 'Your vehicle is ready. Please contact the workshop to arrange collection.',
  },
  Collected: {
    type: 'collected',
    title: 'Vehicle collected',
    message: 'Your vehicle has been marked as collected. Thank you for choosing NEXTGEN.',
  },
};

export function repairStageIndex(status: string | null | undefined): number {
  if (!status) return -1;
  const index = REPAIR_TRACKING_STAGES.findIndex((stage) => stage.status === status);
  return index;
}

export function repairStageLabel(status: string | null | undefined): string {
  const index = repairStageIndex(status);
  return index >= 0 ? REPAIR_TRACKING_STAGES[index].label : status || 'Not recorded';
}

export function customerNotificationTemplate(status: string | null | undefined): CustomerNotificationTemplate | null {
  if (!status) return null;
  return NOTIFICATION_TEMPLATES[status] ?? null;
}

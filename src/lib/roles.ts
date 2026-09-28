import type { Role } from '@shared/types';

export function isStaff(role?: Role) {
  return role === 'admin' || role === 'technician' || role === 'reviewer';
}

export const roleDescriptions: Record<Role, string> = {
  admin:
    'Manage accounts, laboratory workflows, communication delivery and system integration.',
  technician:
    'Register samples and replacements, record processing work, request recollection, add notes, and acknowledge alerts.',
  reviewer:
    'Review and release results, request recollection, add notes, and resolve operational alerts.',
  clinician:
    'Review released results for assigned requests, acknowledge results and manage patient access.',
  patient:
    'Follow your requests and view results when available to you. For clinician requests, result access is managed by the assigned clinician.',
  transporter:
    'View collection and delivery details for assigned specimens. Patient identifiers and clinical results are excluded.',
};

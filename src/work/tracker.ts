/**
 * Where a ticket lives (chantier 4): Jira for the team's own work, ServiceNow
 * for what customers raise. Read from the source link when there is one, else
 * from the reference itself. A reference that is neither stays « other ».
 */
export type Tracker = 'jira' | 'servicenow' | 'other';

/** ServiceNow numbers: a record prefix and seven digits or so (INC0012345, RITM0004567, CHG…). */
export const SERVICENOW_REF = /^(INC|RITM|REQ|CHG|PRB|PTASK|SCTASK|CTASK|TASK|CS|STRY|ENHC|IDEA)\d{5,10}$/i;
const JIRA_REF = /^[A-Z][A-Z0-9]{1,15}-\d{1,7}$/;

export function trackerOf(ref: string, external?: { readonly provider?: unknown; readonly url?: unknown } | null): Tracker {
  const provider = typeof external?.provider === 'string' ? external.provider : '';
  const url = typeof external?.url === 'string' ? external.url : '';
  if (provider === 'servicenow' || /service-?now/i.test(url)) return 'servicenow';
  if (provider === 'jira' || /atlassian|\/browse\//i.test(url)) return 'jira';
  if (SERVICENOW_REF.test(ref)) return 'servicenow';
  if (JIRA_REF.test(ref)) return 'jira';
  return 'other';
}

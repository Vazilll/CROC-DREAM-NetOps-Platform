import React from 'react';
import {
  Activity,
  LayoutDashboard,
  FlaskConical,
  Layers,
  ShieldCheck,
  ShieldAlert,
  Terminal,
} from 'lucide-react';

import type { UserRole } from './api';

export interface TabItem {
  groupKey: 'overview' | 'inventory' | 'automation' | 'testing';
  id: string;
  labelKey:
    | 'tabDashboard'
    | 'tabDevices'
    | 'tabJobs'
    | 'tabDiff'
    | 'tabDrift'
    | 'tabLab'
    | 'tabEmergency';
  Icon: React.ComponentType<{ className?: string }>;
  minRole?: UserRole;
}

const ROLE_RANK: Record<UserRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
  owner: 4,
};

export const TAB_DEFINITIONS: TabItem[] = [
  { groupKey: 'overview', id: 'dashboard', labelKey: 'tabDashboard', Icon: LayoutDashboard, minRole: 'viewer' },
  { groupKey: 'inventory', id: 'devices', labelKey: 'tabDevices', Icon: Layers, minRole: 'viewer' },
  { groupKey: 'automation', id: 'jobs', labelKey: 'tabJobs', Icon: Activity, minRole: 'viewer' },
  { groupKey: 'automation', id: 'diff', labelKey: 'tabDiff', Icon: Terminal, minRole: 'viewer' },
  { groupKey: 'automation', id: 'drift', labelKey: 'tabDrift', Icon: ShieldCheck, minRole: 'viewer' },
  { groupKey: 'testing', id: 'lab', labelKey: 'tabLab', Icon: FlaskConical, minRole: 'operator' },
  { groupKey: 'testing', id: 'emergency', labelKey: 'tabEmergency', Icon: ShieldAlert, minRole: 'admin' },
];

export function getVisibleTabs(role: UserRole = 'viewer'): TabItem[] {
  const rank = ROLE_RANK[role] ?? 1;
  return TAB_DEFINITIONS.filter((item) => rank >= (ROLE_RANK[item.minRole ?? 'viewer'] ?? 1));
}

export const PLATFORM_NAMES: Record<string, string> = {
  arista_eos: 'Arista EOS',
  cisco_iosxe: 'Cisco IOS-XE',
  huawei_vrp: 'Huawei VRP',
  juniper_junos: 'Juniper Junos',
  eltex_mes: 'Eltex MES',
  eltex_esr: 'Eltex ESR',
  yadro_kornfe: 'YADRO Kornfe',
  linux_server: 'Linux Server',
};

export const ROLE_NAMES: Record<string, string> = {
  spine: 'Spine',
  leaf: 'Leaf',
  border: 'Border',
  border_firewall: 'Border FW',
  server: 'Server / Compute',
};

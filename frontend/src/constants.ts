import React from 'react';
import {
  Activity,
  LayoutDashboard,
  FlaskConical,
  Layers,
  ShieldCheck,
  Terminal,
} from 'lucide-react';

export interface TabItem {
  groupKey: 'overview' | 'inventory' | 'automation' | 'testing';
  id: string;
  labelKey: 'tabDashboard' | 'tabDevices' | 'tabJobs' | 'tabDiff' | 'tabDrift' | 'tabLab';
  Icon: React.ComponentType<{ className?: string }>;
}

export const TAB_DEFINITIONS: TabItem[] = [
  { groupKey: 'overview', id: 'dashboard', labelKey: 'tabDashboard', Icon: LayoutDashboard },
  { groupKey: 'inventory', id: 'devices', labelKey: 'tabDevices', Icon: Layers },
  { groupKey: 'automation', id: 'jobs', labelKey: 'tabJobs', Icon: Activity },
  { groupKey: 'automation', id: 'diff', labelKey: 'tabDiff', Icon: Terminal },
  { groupKey: 'automation', id: 'drift', labelKey: 'tabDrift', Icon: ShieldCheck },
  { groupKey: 'testing', id: 'lab', labelKey: 'tabLab', Icon: FlaskConical },
];

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

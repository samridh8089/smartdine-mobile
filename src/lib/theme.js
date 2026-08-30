/**
 * SmartDine Mobile — Design System
 * Same theme as the web app (cleverops.in)
 */

export const COLORS = {
  // Primary (Emerald Green — same as web sidebar active)
  primary: '#059669',
  primaryLight: '#d1fae5',
  primaryDark: '#047857',

  // Background
  background: '#f1f5f9',
  surface: '#ffffff',
  surfaceSecondary: '#f8fafc',

  // Text
  textPrimary: '#1e293b',
  textSecondary: '#64748b',
  textMuted: '#94a3b8',
  textInverse: '#ffffff',

  // Status Colors
  success: '#059669',
  successLight: '#d1fae5',
  warning: '#f59e0b',
  warningLight: '#fef3c7',
  danger: '#ef4444',
  dangerLight: '#fee2e2',
  info: '#3b82f6',
  infoLight: '#dbeafe',
  purple: '#8b5cf6',
  purpleLight: '#ede9fe',
  orange: '#f97316',
  orangeLight: '#ffedd5',

  // Order Status Colors
  statusNew: '#6366f1',
  statusNewBg: '#eef2ff',
  statusAccepted: '#f59e0b',
  statusAcceptedBg: '#fef3c7',
  statusPreparing: '#f97316',
  statusPreparingBg: '#ffedd5',
  statusReady: '#8b5cf6',
  statusReadyBg: '#ede9fe',
  statusServed: '#059669',
  statusServedBg: '#d1fae5',
  statusCompleted: '#64748b',
  statusCompletedBg: '#f1f5f9',
  statusCancelled: '#ef4444',
  statusCancelledBg: '#fee2e2',

  // Role Colors
  roleOwner: '#f97316',
  roleManager: '#3b82f6',
  roleKitchen: '#059669',
  roleWaiter: '#8b5cf6',
  roleCashier: '#ec4899',
  roleSuperAdmin: '#1e293b',

  // Border
  border: '#e2e8f0',
  borderLight: '#f1f5f9',

  // Liquid Glass Design Tokens
  glassBg: 'rgba(15, 23, 42, 0.75)',
  glassCard: 'rgba(30, 41, 59, 0.70)',
  glassBorder: 'rgba(255, 255, 255, 0.22)',
  glassBorderLight: 'rgba(255, 255, 255, 0.12)',
  glassAccent: '#059669',
  glassText: '#ffffff',
  glassTextMuted: '#94a3b8',
};

export const GLASS_STYLES = {
  card: {
    backgroundColor: 'rgba(30, 41, 59, 0.72)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  pill: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 9999,
  },
  button: {
    backgroundColor: '#059669',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    borderRadius: 14,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  }
};

export const FONTS = {
  regular: { fontWeight: '400' },
  medium: { fontWeight: '500' },
  semiBold: { fontWeight: '600' },
  bold: { fontWeight: '700' },
  extraBold: { fontWeight: '800' },
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const RADIUS = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  full: 9999,
};

export const SHADOWS = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 8,
  },
};

// Get color for order status
export function getStatusColor(status) {
  const map = {
    new: { bg: COLORS.statusNewBg, text: COLORS.statusNew },
    accepted: { bg: COLORS.statusAcceptedBg, text: COLORS.statusAccepted },
    preparing: { bg: COLORS.statusPreparingBg, text: COLORS.statusPreparing },
    ready: { bg: COLORS.statusReadyBg, text: COLORS.statusReady },
    served: { bg: COLORS.statusServedBg, text: COLORS.statusServed },
    completed: { bg: COLORS.statusCompletedBg, text: COLORS.statusCompleted },
    cancelled: { bg: COLORS.statusCancelledBg, text: COLORS.statusCancelled },
  };
  return map[status] || { bg: COLORS.borderLight, text: COLORS.textSecondary };
}

export function getStatusLabel(status) {
  const map = {
    new: 'New',
    accepted: 'Accepted',
    preparing: 'Preparing',
    ready: 'Ready',
    served: 'Served',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };
  return map[status] || status;
}

export function getRoleColor(role) {
  const map = {
    owner: COLORS.roleOwner,
    manager: COLORS.roleManager,
    kitchen: COLORS.roleKitchen,
    waiter: COLORS.roleWaiter,
    cashier: COLORS.roleCashier,
    super_admin: COLORS.roleSuperAdmin,
  };
  return map[role] || COLORS.textSecondary;
}

export function getRoleLabel(role) {
  const map = {
    owner: 'Owner',
    manager: 'Manager',
    kitchen: 'Kitchen',
    waiter: 'Waiter',
    cashier: 'Cashier',
    super_admin: 'Super Admin',
  };
  return map[role] || role;
}

export function formatCurrency(amount) {
  return `₹${parseFloat(amount || 0).toFixed(0)}`;
}

export function formatOrderId(id) {
  if (!id) return '#---';
  return `#${String(id).slice(-4).toUpperCase()}`;
}

import { formatExactTimestamp } from './timestamp';

export function timeAgo(dateStr) {
  return formatExactTimestamp(dateStr);
}

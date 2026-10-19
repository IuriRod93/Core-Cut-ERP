export type ModuleKey =
  | 'dashboard' | 'tasks' | 'agenda' | 'leads' | 'clients' | 'budgets' | 'contracts' | 'projects'
  | 'production' | 'shopfloor' | 'cutplan' | 'bom' | 'quality' | 'maintenance' | 'logistics' | 'warranty'
  | 'inventory' | 'purchases' | 'suppliers' | 'financial' | 'team' | 'timeclock' | 'vehicles'
  | 'reports' | 'files' | 'settings' | 'audit'

export type RoleKey =
  | 'admin' | 'gerente' | 'comercial' | 'projetista' | 'pcp' | 'producao' | 'suprimentos' | 'financeiro' | 'instalador'

export interface CollectionRule {
  modules: ModuleKey[]
  readAll?: boolean
  readOnly?: boolean
  own?: string
  prefix?: string
}

export const MODULES: Record<ModuleKey, string>
export const MODULE_KEYS: ModuleKey[]
export const ROLES: Record<RoleKey, string>
export const ROLE_DEFAULT_MODULES: Record<RoleKey, ModuleKey[]>
export const COLLECTIONS: Record<string, CollectionRule>
export function isManagerRole(role: string): boolean
export function resolveModules(user: {
  role: string
  active?: boolean
  extraModules?: string[]
  deniedModules?: string[]
} | null | undefined): ModuleKey[]
export function canAccessModule(user: Parameters<typeof resolveModules>[0], key: ModuleKey): boolean

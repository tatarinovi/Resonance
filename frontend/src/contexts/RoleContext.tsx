/**
 * Re-exports `useRole` so pages copied from the reference (which import from
 * `@/contexts/RoleContext`) keep working. The actual identity now comes from
 * `AuthContext`.
 */
export { useRole, AuthProvider as RoleProvider } from "./AuthContext";

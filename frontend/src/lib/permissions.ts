export type UserRol = 'admin' | 'usuario'

// Rutas accesibles para usuarios no-admin
export const USER_ALLOWED_ROUTES: readonly string[] = ['/planeacion', '/catalogo']

export function isRouteAllowed(pathname: string | null, isAdmin: boolean): boolean {
  if (isAdmin) return true
  if (!pathname) return false
  return USER_ALLOWED_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))
}

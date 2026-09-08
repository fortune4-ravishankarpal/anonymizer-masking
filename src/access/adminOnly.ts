import type { Access, PayloadRequest } from 'payload'

export const adminOnly = ({ req }: { req: PayloadRequest }): boolean => {
  const roles = (req.user as { roles?: string[] } | null | undefined)?.roles

  return Array.isArray(roles) && roles.includes('admin')
}

export const authenticated: Access = ({ req }) => Boolean(req.user)

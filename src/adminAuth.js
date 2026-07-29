const configuredAdminUids = String(import.meta.env.VITE_FIREBASE_ADMIN_UIDS || '')
  .split(',')
  .map((uid) => uid.trim())
  .filter(Boolean);

export const FIREBASE_ADMIN_UIDS = Object.freeze(configuredAdminUids);

export function isFirebaseAdmin(authUser) {
  const isGoogleUser = authUser?.providerData?.some(
    (provider) => provider.providerId === 'google.com'
  );

  return Boolean(
    authUser?.uid
    && authUser.isAnonymous === false
    && isGoogleUser
    && FIREBASE_ADMIN_UIDS.includes(authUser.uid)
  );
}

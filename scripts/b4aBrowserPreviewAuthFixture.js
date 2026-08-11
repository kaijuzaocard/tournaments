import { B4A_PREVIEW_ADMIN_FIXTURE } from '../src/b4aPreviewAdminFixture.js';

export function isAuthUserNotFound(error) {
  return error?.code === 'auth/user-not-found';
}

export async function deleteB4APreviewAdminFixture(authApi) {
  try {
    await authApi.deleteUser(B4A_PREVIEW_ADMIN_FIXTURE.uid);
    return 'deleted';
  } catch (error) {
    if (isAuthUserNotFound(error)) return 'not_found';
    throw error;
  }
}

export async function importB4APreviewAdminFixture(authApi) {
  await deleteB4APreviewAdminFixture(authApi);
  const result = await authApi.importUsers([{
    uid: B4A_PREVIEW_ADMIN_FIXTURE.uid,
    email: B4A_PREVIEW_ADMIN_FIXTURE.email,
    emailVerified: true,
    displayName: B4A_PREVIEW_ADMIN_FIXTURE.displayName,
    providerData: [{
      providerId: B4A_PREVIEW_ADMIN_FIXTURE.providerId,
      uid: B4A_PREVIEW_ADMIN_FIXTURE.providerSub,
      email: B4A_PREVIEW_ADMIN_FIXTURE.email,
      displayName: B4A_PREVIEW_ADMIN_FIXTURE.displayName,
    }],
  }]);
  if (result.successCount !== 1 || result.failureCount !== 0) {
    throw new Error('B4A_PREVIEW_AUTH_IMPORT_FAILED');
  }
  const imported = await authApi.getUser(B4A_PREVIEW_ADMIN_FIXTURE.uid);
  const provider = imported.providerData.find(
    (item) => item.providerId === B4A_PREVIEW_ADMIN_FIXTURE.providerId,
  );
  if (imported.uid !== B4A_PREVIEW_ADMIN_FIXTURE.uid
    || provider?.uid !== B4A_PREVIEW_ADMIN_FIXTURE.providerSub) {
    throw new Error('B4A_PREVIEW_AUTH_IMPORT_VERIFICATION_FAILED');
  }
  return imported;
}

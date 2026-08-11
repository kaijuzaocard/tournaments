import {
  GoogleAuthProvider,
  getIdTokenResult,
  signInAnonymously,
  signInWithCredential,
  signOut,
} from 'firebase/auth';
import { isLoopbackUrl } from './firebaseRuntimeConfig.js';
import {
  B4A_PREVIEW_ADMIN_FIXTURE,
  B4A_PREVIEW_AUTH_ENDPOINT,
  B4A_PREVIEW_GOOGLE_ID_TOKEN_CLAIMS,
  B4A_PREVIEW_PROJECT_ID,
} from './b4aPreviewAdminFixture.js';

export const B4A_PREVIEW_ADMIN_IDENTITY_MISMATCH = 'B4A_PREVIEW_ADMIN_IDENTITY_MISMATCH';

export function assertB4APreviewAdminRuntime({
  isFirebaseEmulatorRuntime,
  runtimeInfo,
  browserOrigin,
}) {
  if (isFirebaseEmulatorRuntime !== true
    || runtimeInfo?.mode !== 'emulator'
    || runtimeInfo?.projectId !== B4A_PREVIEW_PROJECT_ID
    || runtimeInfo?.connected !== true
    || runtimeInfo?.authEndpoint !== B4A_PREVIEW_AUTH_ENDPOINT
    || !isLoopbackUrl(browserOrigin)) {
    throw new Error(B4A_PREVIEW_ADMIN_IDENTITY_MISMATCH);
  }
  return true;
}

export function createB4APreviewGoogleCredential({
  isFirebaseEmulatorRuntime,
  runtimeInfo,
  browserOrigin,
  credentialFactory = GoogleAuthProvider.credential,
}) {
  assertB4APreviewAdminRuntime({ isFirebaseEmulatorRuntime, runtimeInfo, browserOrigin });
  return credentialFactory(JSON.stringify(B4A_PREVIEW_GOOGLE_ID_TOKEN_CLAIMS));
}

export function validateB4APreviewAdminIdentity({ user, tokenResult, isAdminUser }) {
  const provider = user?.providerData?.find(
    (item) => item.providerId === B4A_PREVIEW_ADMIN_FIXTURE.providerId,
  );
  if (user?.uid !== B4A_PREVIEW_ADMIN_FIXTURE.uid
    || user?.isAnonymous !== false
    || provider?.uid !== B4A_PREVIEW_ADMIN_FIXTURE.providerSub
    || provider?.email !== B4A_PREVIEW_ADMIN_FIXTURE.email
    || tokenResult?.signInProvider !== B4A_PREVIEW_ADMIN_FIXTURE.providerId
    || isAdminUser?.(user) !== true) {
    throw new Error(B4A_PREVIEW_ADMIN_IDENTITY_MISMATCH);
  }
  return Object.freeze({
    uid: user.uid,
    isAnonymous: false,
    providerId: provider.providerId,
    providerSub: provider.uid,
    signInProvider: tokenResult.signInProvider,
  });
}

export async function signInWithB4APreviewAdmin({
  auth,
  isFirebaseEmulatorRuntime,
  runtimeInfo,
  browserOrigin,
  isAdminUser,
  verifyAdminAuthority,
  credentialFactory = GoogleAuthProvider.credential,
  signInWithCredentialFn = signInWithCredential,
  getIdTokenResultFn = getIdTokenResult,
  signOutFn = signOut,
  signInAnonymouslyFn = signInAnonymously,
}) {
  try {
    const credential = createB4APreviewGoogleCredential({
      isFirebaseEmulatorRuntime,
      runtimeInfo,
      browserOrigin,
      credentialFactory,
    });
    const result = await signInWithCredentialFn(auth, credential);
    const tokenResult = await getIdTokenResultFn(result.user);
    const identity = validateB4APreviewAdminIdentity({
      user: result.user,
      tokenResult,
      isAdminUser,
    });
    const authority = await verifyAdminAuthority?.(result.user);
    if (authority !== true) throw new Error(B4A_PREVIEW_ADMIN_IDENTITY_MISMATCH);
    return Object.freeze({ ...identity, functionsAdminCallable: 'accepted' });
  } catch {
    try {
      await signOutFn(auth);
      await signInAnonymouslyFn(auth);
    } catch {
      // The identity remains fail-closed even if anonymous recovery is unavailable.
    }
    throw new Error(B4A_PREVIEW_ADMIN_IDENTITY_MISMATCH);
  }
}

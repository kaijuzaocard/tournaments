export async function bootstrapFirebaseAuth({
  auth,
  initialAuthToken,
  signInWithCustomToken,
  signInAnonymously,
  logger = console,
}) {
  await auth.authStateReady();

  if (initialAuthToken) {
    try {
      await signInWithCustomToken(auth, initialAuthToken);
      return;
    } catch (error) {
      logger.warn('Custom token failed', {
        code: error?.code || 'CUSTOM_TOKEN_FAILED',
      });
    }
  }

  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
}

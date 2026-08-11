export const B4A_PREVIEW_PROJECT_ID = 'demo-kaijuzaocard-calendar-browser';
export const B4A_PREVIEW_AUTH_ENDPOINT = 'http://127.0.0.1:9099';
export const B4A_PREVIEW_ADMIN_PROBE_EVENT_ID = 'b4a-preview-e1-legacy-open';
export const B4A_PREVIEW_ADMIN_PROBE_SWISS_ID = 'b4a-preview-swiss-admin-probe';
export const B4A_PREVIEW_ADMIN_MANAGEMENT_EVENT_ID = 'b4a-preview-e5-ranked-waitlist';
export const B4A_PREVIEW_ADMIN_MANAGEMENT_SWISS_ID = 'b4a-preview-swiss-admin-management';

export const B4A_PREVIEW_ADMIN_FIXTURE = Object.freeze({
  uid: 'z1JOoARRRsSFavRlGbnhZmM4NMQ2',
  providerSub: 'b4a-preview-google-admin-sub',
  email: 'b4a-admin@example.test',
  displayName: 'B4A Preview Admin',
  providerId: 'google.com',
});

export const B4A_PREVIEW_GOOGLE_ID_TOKEN_CLAIMS = Object.freeze({
  sub: B4A_PREVIEW_ADMIN_FIXTURE.providerSub,
  email: B4A_PREVIEW_ADMIN_FIXTURE.email,
  email_verified: true,
  name: B4A_PREVIEW_ADMIN_FIXTURE.displayName,
});

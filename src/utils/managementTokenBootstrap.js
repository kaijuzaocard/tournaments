const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
let managementRoute = null;
let generatedManagementUrl = null;

function captureManagementRoute(locationObject, historyObject) {
  if (!locationObject || !historyObject) return null;

  const params = new URLSearchParams(String(locationObject.hash || '').replace(/^#/, ''));
  const token = params.get('manage');
  if (!token) return null;

  const query = new URLSearchParams(locationObject.search || '');
  const calendarEventId = String(query.get('event') || '').trim();
  const registrationId = String(query.get('registration') || '').trim();
  const cleanUrl = `${locationObject.pathname}${locationObject.search}`;
  historyObject.replaceState(historyObject.state, '', cleanUrl);

  if (!SAFE_ID.test(calendarEventId) || !SAFE_ID.test(registrationId) || token.length < 32) {
    return { invalid: true };
  }

  return { calendarEventId, registrationId, managementToken: token };
}

if (typeof window !== 'undefined') {
  managementRoute = captureManagementRoute(window.location, window.history);
}

export function getManagementRoute() {
  if (!managementRoute) return null;
  const { managementToken: _token, ...route } = managementRoute;
  return { ...route };
}

export function withManagementToken(callback) {
  if (!managementRoute || managementRoute.invalid) throw new Error('INVALID_MANAGEMENT_LINK');
  return callback(managementRoute.managementToken, {
    calendarEventId: managementRoute.calendarEventId,
    registrationId: managementRoute.registrationId,
  });
}

export function clearManagementRoute() {
  managementRoute = null;
}

export function storeGeneratedManagementUrl(url) {
  generatedManagementUrl = String(url || '');
}

export async function consumeGeneratedManagementUrl(callback) {
  if (!generatedManagementUrl) throw new Error('MANAGEMENT_LINK_ALREADY_CONSUMED');
  await callback(generatedManagementUrl);
  generatedManagementUrl = null;
}

export function clearGeneratedManagementUrl() {
  generatedManagementUrl = null;
}

export { captureManagementRoute };

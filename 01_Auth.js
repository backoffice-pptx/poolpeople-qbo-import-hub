/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 01_Auth.js
 * Purpose     : QBO OAuth authorization, token access, connection testing, and authentication helpers.
 *
 * Public API:
 *   - getQboService()
 *   - showRedirectUri()
 *   - startAuth()
 *   - authCallback()
 *   - resetAuth()
 *   - testCompanyInfo()
 *
 * Internal Helpers:
 *   - None
 *
 * Dependencies:
 *   - Other Application 50 modules as referenced by function calls
 *   - Google Apps Script services used by this module
 *
 * Current Owner:
 *   - 50 QBO Import Hub
 *
 * Future Ownership:
 *   - Remains in Application 50 unless a later approved architecture decision assigns a narrower reusable component elsewhere.
 *
 * Change History:
 *   - 2026-07-21: Added standardized module documentation. No runtime behavior
 *     changed.
 * ============================================================================
 */


/***********************
 * 01_Auth.gs
 * QuickBooks OAuth2 authorization
 ***********************/

function getQboService() {
  const cfg = getConfig_();
  const scope = cfg.scopes;

  return OAuth2.createService('qbo')
    .setAuthorizationBaseUrl(cfg.authUrl)
    .setTokenUrl(cfg.tokenUrl)
    .setClientId(cfg.clientId)
    .setClientSecret(cfg.clientSecret)
    .setCallbackFunction('authCallback')
    .setPropertyStore(PropertiesService.getUserProperties())
    .setScope(scope)
    .setParam('scope', scope)
    .setParam('response_type', 'code');
}


/**
 * Logs the redirect URI that must be entered
 * in the Intuit developer app.
 */
function showRedirectUri() {
  Logger.log(getQboService().getRedirectUri());
}


/**
 * Logs the Intuit authorization URL.
 */
function startAuth() {
  Logger.log(getQboService().getAuthorizationUrl());
}


/**
 * Handles the OAuth callback from Intuit.
 */
function authCallback(request) {
  const service = getQboService();
  const authorized = service.handleCallback(request);

  if (authorized && request?.parameter?.realmId) {
    PropertiesService
      .getUserProperties()
      .setProperty('QBO_REALM_ID', request.parameter.realmId);
  }

  return HtmlService.createHtmlOutput(
    authorized ? 'Authorized' : 'Authorization denied'
  );
}


/**
 * Clears the stored QBO authorization.
 */
function resetAuth() {
  getQboService().reset();

  PropertiesService
    .getUserProperties()
    .deleteProperty('QBO_REALM_ID');

  safeLog_('QBO authorization reset.');
}
/**
 * Tests the QBO connection by requesting company information.
 */
function testCompanyInfo() {
  const service = getQboService();

  if (!service.hasAccess()) {
    throw new Error('Not authorized. Run startAuth() first.');
  }

  const realmId = PropertiesService
    .getUserProperties()
    .getProperty('QBO_REALM_ID');

  if (!realmId) {
    throw new Error('Missing realmId. Re-authorize the app.');
  }

  const cfg = getConfig_();

  const data = qboGet_(
    `companyinfo/${realmId}?minorversion=${cfg.minorVersion}`
  );

  safeLog_(
    'Connected to QBO company: ' +
    (data?.CompanyInfo?.CompanyName || realmId)
  );
}
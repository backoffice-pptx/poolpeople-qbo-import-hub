/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 10_QBO_REST.js
 * Purpose     : Low-level QuickBooks Online REST query and request helpers.
 *
 * Public API:
 *   - None
 *
 * Internal Helpers:
 *   - qboGet_()
 *   - qboFetchAll_()
 *   - qboQueryAllGeneric_()
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
 * 10_QBO_HTTP.gs
 * QBO HTTP and query helpers
 ***********************/

/**
 * Calls a QBO GET endpoint and returns parsed JSON.
 *
 * Example path:
 *   preferences?minorversion=75
 */
function qboGet_(path) {
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
  const url = `${cfg.qboBase}${realmId}/${path}`;

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + service.getAccessToken(),
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();

  if (status < 200 || status >= 300) {
    throw new Error(
      `QBO GET failed for ${path}. ` +
      `HTTP ${status}: ${response.getContentText().slice(0, 1000)}`
    );
  }

  return JSON.parse(response.getContentText());
}


/**
 * Executes multiple authorized QBO GET requests in parallel.
 */
function qboFetchAll_(urls) {
  const service = getQboService();

  if (!service.hasAccess()) {
    throw new Error('Not authorized. Run startAuth() first.');
  }

  const accessToken = service.getAccessToken();

  const requests = urls.map(function(url) {
    return {
      url: url,
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        Accept: 'application/json'
      },
      muteHttpExceptions: true
    };
  });

  return UrlFetchApp.fetchAll(requests);
}

/**
 * Runs a paginated QBO query and returns all matching entities.
 *
 * Optional example:
 *   qboQueryAllGeneric_(
 *     'SELECT * FROM Customer',
 *     'Customer',
 *     { include: 'enhancedAllCustomFields' }
 *   );
 */
function qboQueryAllGeneric_(baseQuery, entityName, options) {
  options = options || {};

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
  const accessToken = service.getAccessToken();

  const allItems = [];
  const pageSize = 1000;
  let startPosition = 1;

  while (true) {
    const query =
      `${baseQuery} ` +
      `STARTPOSITION ${startPosition} ` +
      `MAXRESULTS ${pageSize}`;

    const extraParams = options.include
      ? `&include=${encodeURIComponent(options.include)}`
      : '';

    const url =
      `${cfg.qboBase}${realmId}/query` +
      `?query=${encodeURIComponent(query)}` +
      `&minorversion=${cfg.minorVersion}` +
      extraParams;

    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        Accept: 'application/json'
      },
      muteHttpExceptions: true
    });

    const status = response.getResponseCode();

    if (status < 200 || status >= 300) {
      throw new Error(
        `QBO query failed for ${entityName}. ` +
        `HTTP ${status}: ${response.getContentText().slice(0, 1000)}`
      );
    }

    const json = JSON.parse(response.getContentText());

    const items =
      json.QueryResponse &&
      Array.isArray(json.QueryResponse[entityName])
        ? json.QueryResponse[entityName]
        : [];

    allItems.push.apply(allItems, items);

    if (items.length < pageSize) {
      break;
    }

    startPosition += pageSize;
  }

  return allItems;
}

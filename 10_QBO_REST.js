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
 *   - qboRequestJson_()
 *   - qboParseJsonResponse_()
 *   - qboFormatFaultDetails_()
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
 *   - 2026-09-01: Centralized QBO HTTP/JSON response validation and QBO Fault
 *     formatting so REST callers report failures consistently with request
 *     context. No retry policy was added; retries remain Objective 11.
 *   - 2026-09-01: Reused the centralized QBO realm ID helper instead of
 *     reading the QBO_REALM_ID user property directly in REST functions.
 *   - 2026-08-27: Added page-level and total query performance diagnostics for timeout analysis. No query behavior changed.
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

  const realmId = getQboRealmId_();

  const cfg = getConfig_();
  const url = `${cfg.qboBase}${realmId}/${path}`;

  return qboRequestJson_(
    url,
    {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + service.getAccessToken(),
        Accept: 'application/json'
      },
      muteHttpExceptions: true
    },
    `QBO GET ${path}`
  );
}


/**
 * Executes one QBO HTTP request and returns parsed JSON.
 *
 * This is the single-request transport boundary used by REST and GraphQL.
 * Objective 11 may add retry/backoff here without changing entity exporters.
 */
function qboRequestJson_(url, fetchOptions, context) {
  const response = UrlFetchApp.fetch(url, fetchOptions);
  return qboParseJsonResponse_(response, context);
}


/**
 * Validates one QBO HTTP response and returns parsed JSON.
 *
 * HTTP failures, malformed JSON, and Intuit Fault details are normalized into
 * one consistent error format while preserving the caller-provided context.
 */
function qboParseJsonResponse_(response, context) {
  const requestContext = String(context || 'QBO request').trim() || 'QBO request';
  const status = response.getResponseCode();
  const responseText = response.getContentText() || '';
  let parsed = {};

  if (responseText) {
    try {
      parsed = JSON.parse(responseText);
    } catch (error) {
      throw new Error(
        `${requestContext} returned invalid JSON. ` +
        `HTTP ${status}: ${responseText.slice(0, 1000)}`
      );
    }
  }

  if (status < 200 || status >= 300) {
    const faultDetails = qboFormatFaultDetails_(parsed);
    const fallbackDetails = responseText.slice(0, 1000);
    const details = faultDetails || fallbackDetails || 'No response body.';

    throw new Error(
      `${requestContext} failed. HTTP ${status}: ${details}`
    );
  }

  return parsed;
}


/**
 * Returns a compact human-readable description of an Intuit Fault payload.
 */
function qboFormatFaultDetails_(parsed) {
  const errors = parsed && parsed.Fault && Array.isArray(parsed.Fault.Error)
    ? parsed.Fault.Error
    : [];

  if (errors.length === 0) {
    return '';
  }

  return errors.map(function(error) {
    const parts = [];

    if (error && error.code) {
      parts.push(`code=${error.code}`);
    }

    if (error && error.Message) {
      parts.push(error.Message);
    }

    if (error && error.Detail) {
      parts.push(error.Detail);
    }

    if (error && error.element) {
      parts.push(`element=${error.element}`);
    }

    return parts.join(' | ');
  }).filter(Boolean).join(' || ').slice(0, 1000);
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

  const responses = UrlFetchApp.fetchAll(requests);

  responses.forEach(function(response, index) {
    qboParseJsonResponse_(
      response,
      `QBO parallel GET ${index + 1} of ${responses.length}`
    );
  });

  return responses;
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

  const realmId = getQboRealmId_();

  const cfg = getConfig_();
  const accessToken = service.getAccessToken();

  const allItems = [];
  const pageSize = 1000;
  let startPosition = 1;
  let pageNumber = 0;
  const queryStartedAt = Date.now();

  while (true) {
    pageNumber += 1;
    const pageStartedAt = Date.now();

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

    const json = qboRequestJson_(
      url,
      {
        method: 'get',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          Accept: 'application/json'
        },
        muteHttpExceptions: true
      },
      `QBO query ${entityName} page ${pageNumber}`
    );

    const items =
      json.QueryResponse &&
      Array.isArray(json.QueryResponse[entityName])
        ? json.QueryResponse[entityName]
        : [];

    allItems.push.apply(allItems, items);

    safeLog_(
      `[PERF] QBO ${entityName} page ${pageNumber}: ` +
      `${items.length} rows in ${Date.now() - pageStartedAt} ms; ` +
      `${allItems.length} cumulative.`
    );

    if (items.length < pageSize) {
      break;
    }

    startPosition += pageSize;
  }

  safeLog_(
    `[PERF] QBO ${entityName} query complete: ` +
    `${allItems.length} rows across ${pageNumber} page(s) in ` +
    `${Date.now() - queryStartedAt} ms.`
  );

  return allItems;
}

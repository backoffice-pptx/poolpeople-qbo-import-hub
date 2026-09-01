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
 *   - qboIsRetryableHttpStatus_()
 *   - qboIsRetryableTransportError_()
 *   - qboGetRetryAfterMs_()
 *   - qboComputeRetryDelayMs_()
 *   - qboSleepBeforeRetry_()
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
 *   - 2026-09-01: Added bounded retry/backoff for QBO HTTP 429/5xx responses
 *     and clearly transient transport failures. Permanent auth, permission,
 *     request, and business/data errors are not retried.
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
  const requestContext = String(context || 'QBO request').trim() || 'QBO request';
  const maxAttempts = Math.max(1, Number(QBO_REQUEST_POLICY.MAX_ATTEMPTS) || 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;

    try {
      response = UrlFetchApp.fetch(url, fetchOptions);
    } catch (error) {
      const retryable = qboIsRetryableTransportError_(error);

      if (!retryable || attempt >= maxAttempts) {
        throw new Error(
          `${requestContext} transport failure after ${attempt} attempt(s): ` +
          `${error && error.message ? error.message : String(error)}`
        );
      }

      qboSleepBeforeRetry_(requestContext, attempt, null, error);
      continue;
    }

    const status = response.getResponseCode();

    if (
      qboIsRetryableHttpStatus_(status) &&
      attempt < maxAttempts
    ) {
      qboSleepBeforeRetry_(requestContext, attempt, response, null);
      continue;
    }

    return qboParseJsonResponse_(response, requestContext);
  }

  throw new Error(`${requestContext} failed without a terminal response.`);
}


/**
 * Returns true only for HTTP statuses that are safe to retry automatically.
 */
function qboIsRetryableHttpStatus_(status) {
  return status === 429 || (status >= 500 && status <= 599);
}


/**
 * Returns true for clearly transient UrlFetch transport/service failures.
 *
 * The matcher is intentionally conservative so coding/configuration errors
 * such as invalid arguments or malformed URLs are not retried repeatedly.
 */
function qboIsRetryableTransportError_(error) {
  const message = String(
    error && error.message ? error.message : error || ''
  ).toLowerCase();

  if (!message) {
    return false;
  }

  const transientMarkers = [
    'timed out',
    'timeout',
    'temporarily unavailable',
    'temporary failure',
    'service unavailable',
    'internal error',
    'connection reset',
    'socket',
    'address unavailable',
    'service invoked too many times'
  ];

  return transientMarkers.some(function(marker) {
    return message.indexOf(marker) !== -1;
  });
}


/**
 * Reads Retry-After when QBO supplies it. Supports integer seconds.
 */
function qboGetRetryAfterMs_(response) {
  if (!response || typeof response.getHeaders !== 'function') {
    return null;
  }

  const headers = response.getHeaders() || {};
  let retryAfter = null;

  Object.keys(headers).some(function(name) {
    if (String(name).toLowerCase() === 'retry-after') {
      retryAfter = headers[name];
      return true;
    }
    return false;
  });

  const seconds = Number(retryAfter);

  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  return Math.round(seconds * 1000);
}


/**
 * Calculates bounded exponential backoff, honoring Retry-After when present.
 */
function qboComputeRetryDelayMs_(attempt, response) {
  const configuredBase = Math.max(
    0,
    Number(QBO_REQUEST_POLICY.BASE_RETRY_DELAY_MS) || 0
  );
  const configuredMax = Math.max(
    configuredBase,
    Number(QBO_REQUEST_POLICY.MAX_RETRY_DELAY_MS) || configuredBase
  );
  const retryAfterMs = qboGetRetryAfterMs_(response);

  if (retryAfterMs !== null) {
    return Math.min(retryAfterMs, configuredMax);
  }

  const exponentialDelay = configuredBase * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(exponentialDelay, configuredMax);
}


/**
 * Logs and sleeps before the next bounded retry attempt.
 */
function qboSleepBeforeRetry_(context, attempt, response, error) {
  const delayMs = qboComputeRetryDelayMs_(attempt, response);
  const status = response ? response.getResponseCode() : null;
  const reason = status !== null
    ? `HTTP ${status}`
    : (error && error.message ? error.message : 'transient transport failure');

  safeLog_(
    `${LOG_PREFIX.WARN} ${context} transient failure on attempt ${attempt}: ` +
    `${reason}. Retrying in ${delayMs} ms.`
  );

  if (delayMs > 0) {
    Utilities.sleep(delayMs);
  }
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

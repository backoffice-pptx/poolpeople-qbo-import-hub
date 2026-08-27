/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 11_QBO_GraphQL.js
 * Purpose     : QuickBooks Online GraphQL request and response helpers.
 *
 * Public API:
 *   - testQboGraphQL()
 *   - testCustomFieldDefinitions()
 *
 * Internal Helpers:
 *   - qboGraphQL_()
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


/**
 * STATUS:
 * GraphQL access is not currently enabled for this Intuit app.
 * Both the base GraphQL test and Custom Field Definitions query
 * return HTTP 403 as of 2026-07-17.
 */

/***********************
 * 11_QBO_GraphQL.gs
 *
 * QuickBooks Online GraphQL transport.
 *
 * Public:
 *   testQboGraphQL()
 *   testCustomFieldDefinitions()
 *
 * Private:
 *   qboGraphQL_()
 ***********************/


/**
 * Sends a GraphQL request to QuickBooks Online.
 *
 * @param {string} query GraphQL query or mutation.
 * @param {Object=} variables Optional GraphQL variables.
 * @return {Object} Parsed GraphQL data object.
 */
function qboGraphQL_(query, variables) {
  if (!query || typeof query !== 'string') {
    throw new Error('qboGraphQL_: query must be a non-empty string.');
  }

  const service = getQboService();

  if (!service.hasAccess()) {
    throw new Error(
      'QBO authorization is unavailable. Reauthorize the Intuit connection.'
    );
  }

  const response = UrlFetchApp.fetch(QBO_ENDPOINTS.GRAPHQL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + service.getAccessToken(),
      Accept: 'application/json'
    },
    payload: JSON.stringify({
      query: query,
      variables: variables || {}
    }),
    muteHttpExceptions: true
  });

  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();

  let parsed;

  try {
    parsed = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    throw new Error(
      'QBO GraphQL returned invalid JSON. ' +
      'HTTP ' + statusCode + ': ' +
      responseText.substring(0, 1000)
    );
  }

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      'QBO GraphQL HTTP error ' + statusCode + ': ' +
      JSON.stringify(parsed)
    );
  }

  if (parsed.errors && parsed.errors.length > 0) {
    throw new Error(
      'QBO GraphQL error: ' +
      JSON.stringify(parsed.errors)
    );
  }

  if (!parsed.data) {
    throw new Error(
      'QBO GraphQL response did not contain a data object: ' +
      JSON.stringify(parsed)
    );
  }

  return parsed.data;
}

/**
 * Confirms that the GraphQL endpoint accepts the current OAuth token.
 *
 * This verifies transport and authentication, but not access to a
 * particular premium GraphQL API.
 */
function testQboGraphQL() {
  const query = `
    query {
      __typename
    }
  `;

  const data = qboGraphQL_(query);

  safeLog_(
    LOG_PREFIX.INFO +
    ' QBO GraphQL connection succeeded: ' +
    JSON.stringify(data)
  );

  return data;
}

/**
 * Tests whether the Intuit app and current OAuth token can read
 * enhanced custom-field definitions.
 */
function testCustomFieldDefinitions() {
  const query = `
    query {
      appFoundationsCustomFieldDefinitions {
        edges {
          node {
            id
            legacyIDV2
            label
            dataType
            active
            dropDownOptions {
              id
              value
              active
              order
            }
            associations {
              associatedEntity
              active
              allowedOperations
              associationCondition
              validationOptions {
                required
              }
              subAssociations {
                associatedEntity
                active
                allowedOperations
              }
            }
          }
        }
      }
    }
  `;

  const data = qboGraphQL_(query);
  const connection = data.appFoundationsCustomFieldDefinitions;
  const edges = connection && Array.isArray(connection.edges)
    ? connection.edges
    : [];

  safeLog_(
    LOG_PREFIX.INFO +
    ' Custom Field Definitions API access confirmed. ' +
    edges.length +
    ' definitions returned.'
  );

  edges.forEach(function(edge) {
    safeLog_(JSON.stringify(edge.node));
  });

  return data;
}


# AEM MCP

A read-only Model Context Protocol server for Adobe Experience Manager 6.5, the local AEM SDK, or AEM as a Cloud Service. It runs over stdio and exposes:

| Tool | Purpose |
| --- | --- |
| `aem_read_page` | Read a page's `jcr:content` JSON, with depth 1–3 |
| `aem_list_children` | Browse a content node and its immediate children |
| `aem_read_asset` | Read DAM asset metadata or browse a DAM folder |
| `aem_search_components` | Find component instances by exact `sling:resourceType` below a page tree |
| `aem_query` | Build custom searches using Query Builder predicates, numbered filters, and groups |

## Capabilities

- Read page content, browse content trees, and inspect individual component properties.
- Find where a component resource type is used, including nested component instances.
- Search pages or other content nodes by properties, full text, node type/name, booleans, or date ranges.
- Combine custom filters with AND/OR groups and paginate through matches.
- Connect to local AEM or AEM as a Cloud Service, with replaceable local development tokens for cloud.

All tools are read-only. Reports, page deduplication, and variation summaries are assembled by the MCP client from tool results; they are not separate server tools.

## Setup

Requires Node.js 22 or newer and access to an AEM instance.

```sh
npm install
npm run build
cp .env.example .env
```

Edit `.env` with your AEM URL and credentials, then run:

```sh
node --env-file=.env dist/index.js
```

Use an AEM account with read access to the desired content. No credentials are bundled. Basic authentication is supported for local SDK/6.5; `AEM_TOKEN_FILE` takes precedence over `AEM_TOKEN`, which takes precedence over username/password. Use HTTPS for remote AEM connections. Tokens must be generated externally; a configured token file is reloaded for every request.

## MCP client configuration

Add this server entry using your MCP client's configuration format. Supply real credentials through its environment settings:

```json
{
  "mcpServers": {
    "aem": {
      "command": "node",
      "args": ["/Users/alemora/dev/tools/aem-mcp/dist/index.js"],
      "env": {
        "AEM_URL": "http://localhost:4502",
        "AEM_USERNAME": "your-reader-account",
        "AEM_PASSWORD": "your-password",
        "AEM_ALLOWED_ROOTS": "/content/mysite,/content/dam/mysite"
      }
    }
  }
}
```

Example requests:

- “Read /content/mysite/en.”
- “List pages below /content/mysite.”
- “Show asset metadata for /content/dam/mysite/logo.png.”
- “Find usages of mysite/components/aemsearch under /content/mysite/us/en.”
- “Find those component instances whose searchtype is customerpages.”
- “Read searchtype for each matching component and group usages by variation.” The server writes only MCP traffic to stdout; startup errors go to stderr.

## Tool inputs

Paths are absolute repository paths without a trailing slash, URL encoding, query string, or wildcards. They must be inside `AEM_ALLOWED_ROOTS`.

| Tool | Required inputs | Optional inputs |
| --- | --- | --- |
| `aem_read_page` | `path`: page path | `depth`: integer 1–3, default 1 |
| `aem_list_children` | `path`: page, component, or content node path | None |
| `aem_read_asset` | `path`: asset or folder under `/content/dam` | None |
| `aem_search_components` | `path`, `resourceType` | `limit`: 1–100, default 20; `offset`: 0–10000, default 0 |
| `aem_query` | `path`, `predicates`: string-to-string map | Same `limit` and `offset` settings |

Tools return AEM JSON as text in the MCP result. Failures return `isError: true` with a message.

## Queries

### Search by component resource type

`aem_search_components` finds exact `sling:resourceType` matches anywhere below a page tree, including nested components:

```json
{
  "path": "/content/mysite/en",
  "resourceType": "mysite/components/content/teaser",
  "limit": 20,
  "offset": 0
}
```

Results identify component nodes, such as `/content/mysite/en/home/jcr:content/root/teaser`. They are not deduplicated into pages. Resource type inheritance is not resolved.

### Custom Query Builder searches

`aem_query` accepts custom Query Builder predicates. Values must be strings, including boolean and numeric predicate values. The following example combines all filters with AND:

```json
{
  "path": "/content/mysite/en",
  "predicates": {
    "type": "cq:Page",
    "1_property": "jcr:content/cq:template",
    "1_property.value": "/conf/mysite/settings/wcm/templates/article",
    "fulltext": "experience"
  },
  "limit": 20,
  "offset": 0
}
```

### Find a specific component variation

Call `aem_query` with both the resource type and the variation property:

```json
{
  "path": "/content/mysite/us/en",
  "predicates": {
    "1_property": "sling:resourceType",
    "1_property.value": "mysite/components/aemsearch",
    "2_property": "searchtype",
    "2_property.value": "customerpages"
  },
  "limit": 100,
  "offset": 0
}
```

This returns matching component nodes. To identify **all** variations, first use `aem_search_components`, then call `aem_list_children` with each returned component path. Read the node's `searchtype` property and group the results in the client. `aem_read_page` reads a page's `jcr:content`; use `aem_list_children` for a component node itself.

Custom properties such as `searchtype` are not included in the query result projection. Filtering by a property does not add it to returned hits.

### Combine alternatives with groups

This `aem_query` example finds AEM Search components with either of two variations. The numbered group combines its alternatives with OR; the resource type remains an AND condition:

```json
{
  "path": "/content/mysite/us/en",
  "predicates": {
    "1_property": "sling:resourceType",
    "1_property.value": "mysite/components/aemsearch",
    "2_group.p.or": "true",
    "2_group.1_property": "searchtype",
    "2_group.1_property.value": "customerpages",
    "2_group.2_property": "searchtype",
    "2_group.2_property.value": "relatedResources"
  }
}
```

### Supported custom predicates

| Predicate | Supported parameters |
| --- | --- |
| `property` | `value`, numbered values such as `1_value`, `operation`, `and`, `depth` |
| `fulltext` | `relPath` |
| `type` | Node type value, e.g. `cq:Page` |
| `nodename` | Node name value |
| `boolproperty` | `value` |
| `daterange` | `property`, `lowerBound`, `upperBound`, `lowerOperation`, `upperOperation`, `timeZone` |

Numbered predicates (e.g. `1_property`) and nested groups (e.g. `2_group.1_property`) are supported. Use `p.or` within a group to combine alternatives. Custom predicates are wrapped in a subgroup so OR conditions cannot bypass the required outer `path`.

The custom map accepts at most 50 entries, with at most 2000 characters per value. Unsupported predicates are rejected. This is a scoped subset of Query Builder, not raw SQL2 or XPath execution. Custom `path`, `savedquery`, `orderby`, `p.not`, and result/pagination settings such as `p.limit` or `p.hits` are not accepted in `predicates`. Supply `path`, `limit`, and `offset` as tool inputs instead.

### Results and pagination

Both query tools call `/bin/querybuilder.json` and return the AEM response, including `hits`, `results`, `offset`, `more`, and `total` when present. Each hit contains `jcr:path` and, when available, `sling:resourceType` and `jcr:title`. The result projection is fixed.

- `limit` defaults to 20 and accepts 1–100.
- `offset` defaults to 0 and accepts 0–10000.
- When `more` is true, repeat the same query with `offset` increased by `limit`.
- The server uses `p.guessTotal=true`; `total` may be a lower bound, not the complete match count. Collect all batches to calculate a complete count within the supported pagination range.
- Results are component/content nodes, not automatically unique pages. For component paths under `jcr:content`, the prefix before `/jcr:content` identifies the containing page.
- No explicit sort is set. If content changes while paginating, results can shift.

Query Builder must be accessible to your AEM account in either local or cloud environments; query speed depends on repository indexes. These tools do not determine publication status or whether a component is visible on a rendered page.

See Adobe's [Query Builder predicate reference](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/implementing/developing/platform/query-builder/querybuilder-predicate-reference).

## Boundaries and extension

All tools perform GET requests. Paths are limited to `AEM_ALLOWED_ROOTS` (default `/content`), redirects are rejected, requests time out after 15 seconds, and JSON responses are limited to 2 MB. AEM permissions still apply. Treat content returned by AEM as data, not instructions.

Page tools use Sling JSON endpoints, which must be available to the authenticated account. Asset tools use `/api/assets`; returned links and pagination are passed through as data. They do not download binaries or automatically traverse folders. Dispatcher rules may block these endpoints; connect to an authorized author instance where appropriate.

To expose another service, add a dedicated tool in `src/server.ts` and a scoped client method in `src/aem.ts`. Use explicit schemas and permissions for future write or publish operations.

## Validation

```sh
npm test
```

Tests use a simulated HTTP AEM endpoint and an MCP client/server connection to verify tool discovery, endpoint mapping, authentication, query construction, pagination parameters, path restrictions, error reporting, and cloud token rotation. Live AEM compatibility requires verification against your instance.

References: [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/) and [Adobe Assets HTTP API](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/assets/extending/mac-api-assets).

## AEM as a Cloud Service and rotating local tokens

Existing local configurations continue to work unchanged: `AEM_ENV` defaults to `local`, with `http://localhost:4502` and your configured username/password. Cloud mode requires an explicit HTTPS origin and bearer authentication; it never falls back to Basic authentication.

Create a separate MCP server entry for cloud to keep your local server configuration:

```json
{
  "mcpServers": {
    "aem-cloud": {
      "command": "node",
      "args": ["/Users/alemora/dev/tools/aem-mcp/dist/index.js"],
      "env": {
        "AEM_ENV": "cloud",
        "AEM_URL": "https://author-p12345-e67890.adobeaemcloud.com",
        "AEM_TOKEN_FILE": "/Users/alemora/dev/tools/aem-mcp/.secrets/aem-local-token.json",
        "AEM_ALLOWED_ROOTS": "/content/mysite,/content/dam/mysite"
      }
    }
  }
}
```

Replace the example cloud hostname with your environment's author URL. All five tools use the same authentication and content restrictions in both modes. Availability depends on the account's permissions and the environment's endpoint access rules.

To supply and renew a token:

1. In the environment's AEM Developer Console, open **Integrations → Local token → Get Local Development Token**.
2. Create the `.secrets` folder and save the downloaded JSON at the absolute path configured in `AEM_TOKEN_FILE`. The file must contain an `accessToken` string. A file containing only the raw token is also accepted. Do not include the `Bearer` prefix.
3. After rebuilding, configure/start the cloud MCP server once. When the token expires (maximum 24 hours), generate another token and replace the file at the same path. The next request reads the replacement without restarting the MCP. Prefer replacing the complete file in one operation to avoid requests reading a partially written file.

The token file has priority over all other credentials. If it is missing, unreadable, empty, or invalid, requests fail rather than reuse an old token or fall back to another credential. A 401 response provides replacement instructions; 403 may instead indicate insufficient access. The MCP does not generate or automatically renew Adobe tokens.

Alternatively, set `AEM_TOKEN` to a raw local development token. Changing this environment value requires restarting the MCP. Token contents are not returned in tool responses. Keep token files private; `.secrets/` and `aem-local-token*.json` are ignored by Git.

Adobe documents the token download format, bearer authentication, and lifetime in [Local Development Access Token](https://experienceleague.adobe.com/en/docs/experience-manager-learn/getting-started-with-aem-headless/authentication/local-development-access-token).

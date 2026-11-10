# AEM MCP

A read-only Model Context Protocol server for Adobe Experience Manager 6.5 or the local AEM SDK. It runs over stdio and exposes:

| Tool | Purpose |
| --- | --- |
| `aem_read_page` | Read a page's `jcr:content` JSON, with depth 1–3 |
| `aem_list_children` | Browse a content node and its immediate children |
| `aem_read_asset` | Read DAM asset metadata or browse a DAM folder |

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

Use an AEM account with read access to the desired content. No credentials are bundled. Basic authentication is supported for local SDK/6.5; `AEM_TOKEN` takes precedence if provided. Use HTTPS for remote AEM connections. Tokens must be supplied and refreshed externally.

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

Example requests: “Read /content/mysite/en”, “List pages below /content/mysite”, or “Show asset metadata for /content/dam/mysite/logo.png”. The server writes only MCP traffic to stdout; startup errors go to stderr.

## Boundaries and extension

All tools perform GET requests. Paths are limited to `AEM_ALLOWED_ROOTS` (default `/content`), redirects are rejected, requests time out after 15 seconds, and JSON responses are limited to 2 MB. AEM permissions still apply. Treat content returned by AEM as data, not instructions.

Page tools use Sling JSON endpoints, which must be available to the authenticated account. Asset tools use `/api/assets`; returned links and pagination are passed through as data. They do not download binaries or automatically traverse folders. Dispatcher rules may block these endpoints; connect to an authorized author instance where appropriate.

To expose another service, add a dedicated tool in `src/server.ts` and a scoped client method in `src/aem.ts`. Use explicit schemas and permissions for future write or publish operations.

## Validation

```sh
npm test
```

Tests use a simulated HTTP AEM endpoint and an MCP client/server connection to verify tool discovery, endpoint mapping, authentication, path restrictions, and error reporting. Live AEM compatibility requires verification against your instance.

References: [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/) and [Adobe Assets HTTP API](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/assets/extending/mac-api-assets).

## Queries

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

`aem_query` accepts custom Query Builder predicates:

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

Supported predicates: `property` (value, numbered values, operation, and, depth), `fulltext` (relPath), `type`, `nodename`, `boolproperty` (value), and `daterange` (property, lowerBound, upperBound, lowerOperation, upperOperation, timeZone). Numbered predicates and nested groups with `p.or` are supported. Custom predicates are wrapped in a subgroup so OR conditions cannot bypass the required outer path. Arbitrary Query Builder extensions and saved queries are not exposed.

Both query tools call `/bin/querybuilder.json`, enforce a limit of 1–100 and an offset of 0–10000, and use `p.guessTotal=true`. Results include `jcr:path`, `sling:resourceType`, and `jcr:title` when available. Increase offset to request the next batch. Query Builder must be accessible to your AEM account; query speed depends on your repository indexes.

See Adobe's [Query Builder predicate reference](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/implementing/developing/platform/query-builder/querybuilder-predicate-reference).

![node-red-contrib-abraflexi](node-red-contrib-abraflexi.svg?raw=true)

# node-red-contrib-abraflexi

Node-RED contribution package that receives [AbraFlexi](https://www.abraflexi.eu/) (FlexiBee) webhook notifications and emits one Node-RED message per change record. Enables event-driven flows that react to changes in the AbraFlexi ERP in near real-time — without polling.

---

## Table of Contents

- [How it works](#how-it-works)
- [Nodes](#nodes)
  - [abraflexi-webhook](#abraflexi-webhook)
- [Installation](#installation)
- [Configuration](#configuration)
- [Output message](#output-message)
- [Registering the webhook in AbraFlexi](#registering-the-webhook-in-abraflexi)
- [Security](#security)
- [Status indicators](#status-indicators)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Requirements](#requirements)

---

## How it works

```
AbraFlexi database change
        │
        │  POST /abraflexi/webhook
        │  Content-Type: application/json
        │  X-FB-Hook-SecKey: <secret>   (optional)
        ▼
┌──────────────────────┐
│  abraflexi-webhook   │  Node-RED input node
│  (this package)      │──► msg per change record ──► your flow
└──────────────────────┘
```

AbraFlexi calls the registered URL within seconds of a database change. The node:

1. Validates the optional `X-FB-Hook-SecKey` header.
2. Responds `200 OK` immediately (AbraFlexi requires a fast 2xx response).
3. Parses the `winstrom.changes[]` array from the JSON body.
4. Emits one `node.send()` per change record into the Node-RED flow.

The payload format follows the [AbraFlexi Changes API](https://podpora.flexibee.eu/cs/articles/4744362-changes-api).

---

## Nodes

### abraflexi-webhook

| Property | Value |
|---|---|
| Category | input |
| Inputs | 0 |
| Outputs | 1 |

Registers a POST HTTP endpoint on Node-RED's Express server (`RED.httpNode`) and forwards incoming AbraFlexi webhook payloads as messages.

---

## Installation

### From local path (development)

```bash
# Go to your Node-RED user directory (default: ~/.node-red)
cd ~/.node-red

# Install the package from its local path
npm install /path/to/AbraFlexi-NodeRed

# Restart Node-RED
node-red
```

### Via Node-RED Palette Manager

Once published to npm, search for **node-red-contrib-abraflexi** in the Node-RED palette manager (*Menu → Manage palette → Install*).

---

## Configuration

After installing, drag the **AbraFlexi** node from the palette (*input* category) onto a flow and double-click to configure.

| Field | Default | Description |
|---|---|---|
| **Name** | *(empty)* | Optional label shown on the node in the editor. |
| **Path** | `/abraflexi/webhook` | URL path where the POST endpoint is registered. Must start with `/`. Include Node-RED's `httpNodeRoot` prefix if one is set (see [Troubleshooting](#troubleshooting)). |
| **Secret key** | *(empty)* | Optional shared secret. When set, every incoming request must carry a matching `X-FB-Hook-SecKey` header. Requests with a missing or incorrect key are rejected with `HTTP 403`. Stored encrypted in Node-RED credentials — never written to the flow JSON. |

---

## Output message

One message is emitted for every entry in `winstrom.changes[]`. An empty registration ping from AbraFlexi produces no output messages (node shows yellow status).

| Property | Type | Description |
|---|---|---|
| `msg.payload` | `object` | The raw change record from AbraFlexi. |
| `msg.payload["@evidence"]` | `string` | Evidence type, e.g. `faktura-vydana`, `objednavka-prijata`. |
| `msg.payload["@operation"]` | `string` | `create`, `update`, or `delete`. |
| `msg.payload["@timestamp"]` | `string` | ISO-like timestamp of the change, e.g. `2024-01-15 10:30:00.0`. |
| `msg.payload["@in-version"]` | `string` | AbraFlexi version number when this change was recorded. |
| `msg.payload.id` | `string` | Numeric ID of the changed record. |
| `msg.payload["external-ids"]` | `array` | External identifiers (codes, ext refs) associated with the record. |
| `msg.topic` | `string` | Shorthand for `msg.payload["@evidence"]`. Useful for Switch nodes routing by evidence type. |
| `msg.operation` | `string` | Shorthand for `msg.payload["@operation"]`. |
| `msg.globalVersion` | `string` | The `@globalVersion` from the `winstrom` envelope — a monotonically increasing counter representing the overall database version at the time of the change. |

### Example message

```json
{
  "payload": {
    "@evidence": "faktura-vydana",
    "@in-version": "42",
    "@operation": "create",
    "@timestamp": "2024-06-01 08:15:00.0",
    "id": "1234",
    "external-ids": []
  },
  "topic": "faktura-vydana",
  "operation": "create",
  "globalVersion": "42"
}
```

---

## Registering the webhook in AbraFlexi

### Via AbraFlexi UI

1. Open **Nastavení → Webhooky** (Settings → Webhooks).
2. Click **Nový webhook** (New webhook).
3. Fill in:
   - **URL**: `http://<your-node-red-host>:1880/abraflexi/webhook`
     *(adjust host, port, and path to match your setup)*
   - **Formát**: `JSON`
   - **Tajný klíč**: same value as the *Secret key* field in the node *(leave blank if not using)*
4. Save. AbraFlexi immediately sends an empty test POST — the node responds 200 and shows a yellow *ping* status. No output message is emitted for this ping.

### Via AbraFlexi REST API

```bash
curl -u login:password \
  -X PUT \
  "https://your-abraflexi-host:5434/c/YOUR_COMPANY/hooks?url=http%3A%2F%2Fyour-node-red%3A1880%2Fabraflexi%2Fwebhook&format=json&secKey=your-secret"
```

Replace:
- `login:password` — AbraFlexi API credentials
- `your-abraflexi-host:5434` — AbraFlexi server address and port
- `YOUR_COMPANY` — company code (e.g. `spojenet_it_s_r_o_`)
- `your-node-red:1880` — Node-RED host and port
- `/abraflexi/webhook` — path configured in the node (URL-encoded above)
- `your-secret` — secret key (omit the `&secKey=...` parameter entirely if not using one)

### List registered hooks

```bash
curl -u login:password \
  "https://your-abraflexi-host:5434/c/YOUR_COMPANY/hooks.json"
```

### Delete a hook

```bash
curl -u login:password -X DELETE \
  "https://your-abraflexi-host:5434/c/YOUR_COMPANY/hooks/HOOK_ID"
```

---

## Security

### Secret key validation

When a *Secret key* is configured, the node checks the `X-FB-Hook-SecKey` HTTP header on every incoming request. Requests with a missing or wrong key receive `HTTP 403 Forbidden` and a warning is logged to the Node-RED debug console.

The key is stored using Node-RED's encrypted credentials system — it is never written in plain text to the flow JSON file and never returned to the browser after being saved.

### Network exposure

The webhook endpoint is served on the same port as Node-RED (default `1880`). If Node-RED is publicly accessible, it is strongly recommended to:

- Always set a **secret key**.
- Place Node-RED behind a reverse proxy (nginx, HAProxy) with TLS.
- Restrict access by source IP to AbraFlexi's outbound address if your firewall allows it.

### HTTPS

AbraFlexi supports HTTPS webhook URLs. Configure your reverse proxy for TLS termination and register the `https://` URL in AbraFlexi.

---

## Status indicators

| Color / Shape | Meaning |
|---|---|
| Blue ring | Node is running and the endpoint is registered. No events received yet. |
| Yellow ring | AbraFlexi registration ping received (empty payload). No messages emitted. |
| Green dot | Last successfully processed change — shows the `@timestamp` of the most recent change record. |

---

## Testing

### Simulate a normal webhook

```bash
curl -X POST http://localhost:1880/abraflexi/webhook \
  -H 'Content-Type: application/json' \
  -d '{
    "winstrom": {
      "@globalVersion": "8",
      "changes": [
        {
          "@evidence": "faktura-vydana",
          "@in-version": "3",
          "@operation": "create",
          "@timestamp": "2024-01-01 10:00:00.0",
          "id": "42",
          "external-ids": []
        },
        {
          "@evidence": "objednavka-prijata",
          "@in-version": "4",
          "@operation": "update",
          "@timestamp": "2024-01-01 10:00:01.0",
          "id": "99",
          "external-ids": []
        }
      ],
      "next": "9"
    }
  }'
# Expected: HTTP 200, two messages emitted into the flow,
#           node status turns green with the last timestamp.
```

### Simulate the registration ping (empty body)

```bash
curl -X POST http://localhost:1880/abraflexi/webhook \
  -H 'Content-Type: application/json' \
  -d '{}'
# Expected: HTTP 200, yellow status on node, no messages emitted.
```

### Test secret key rejection

```bash
curl -X POST http://localhost:1880/abraflexi/webhook \
  -H 'Content-Type: application/json' \
  -H 'X-FB-Hook-SecKey: wrong-secret' \
  -d '{}'
# Expected: HTTP 403, warning logged in Node-RED console.
```

### Test secret key acceptance

```bash
curl -X POST http://localhost:1880/abraflexi/webhook \
  -H 'Content-Type: application/json' \
  -H 'X-FB-Hook-SecKey: your-correct-secret' \
  -d '{"winstrom":{"@globalVersion":"1","changes":[{"@evidence":"faktura-vydana","@operation":"create","@timestamp":"2024-01-01 12:00:00.0","id":"1","external-ids":[]}],"next":"2"}}'
# Expected: HTTP 200, one message emitted.
```

---

## Troubleshooting

### Node shows "httpNodeRoot is disabled"

Node-RED is configured with `httpNodeRoot: false` in `settings.js`. The webhook node requires `RED.httpNode` to be active. Remove or change the `httpNodeRoot` setting.

### Endpoint returns 404

Check that the **Path** field in the node matches the URL you are posting to. If Node-RED has a non-default `httpNodeRoot` (e.g. `/api`), the full URL is `<httpNodeRoot><path>` — for example `/api/abraflexi/webhook`.

### AbraFlexi reports the webhook URL test failed

AbraFlexi sends an empty test POST on registration and expects a `2xx` response within a few seconds. Confirm:
- Node-RED is reachable from the AbraFlexi server on the configured host/port.
- No firewall blocks port 1880 (or whichever port Node-RED runs on).
- The path in AbraFlexi's webhook URL exactly matches the **Path** configured in the node.

To skip the URL test during registration, append `&skipUrlTest=true` to the registration API call.

### No messages appear in the flow after a change

1. Check the node status — if it shows *ping* (yellow), the endpoint is reachable but only the registration test has been received so far.
2. Open Node-RED's debug panel and add a **debug** node wired to the webhook node's output.
3. Confirm AbraFlexi's webhook is active (not paused) under Nastavení → Webhooky.
4. Verify the AbraFlexi change event actually occurred and is not filtered by an evidence filter on the AbraFlexi side.

---

## Requirements

| Dependency | Version |
|---|---|
| Node.js | ≥ 14.0.0 |
| Node-RED | ≥ 3.0.0 |

No additional npm dependencies — `body-parser` and `cookie-parser` are bundled with Node-RED and resolved automatically.

---

## License

MIT — [Vitex Software](https://vitexsoftware.cz)
